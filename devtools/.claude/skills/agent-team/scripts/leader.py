"""`team.py lead` — script supervisor running a team leader in short episodes.

Delegation depth stays 1: the leader agent only RETURNS a JSON plan; this script (not the
leader) spawns every worker. State lives in state.json + handoff.md, so a new leader can take over.

Switches:
- proactive : leader exceeded --lead-token-budget during its stint      -> next leader
- reactive  : leader episode crashed / timed out / unparseable           -> roll back to last checkpoint, next leader
- usage limit / auth on the leader account -> STOP and report (no failover by policy)
"""
from __future__ import annotations

import json
import re
import time
from typing import Dict, List, Optional

import macore as mc
import graph as gr
import engine as en
import clp
import cop

LEAD_PROMPT = """You are the TEAM LEADER (episode {ep}) of agent-team run {run_id}.
You do NOT run tools or start agents. You only return a JSON plan; a supervisor script executes it.
Goal: {goal}

Checkpoint from previous leader (handoff.md):
<<<HANDOFF
{handoff}
HANDOFF>>>

Current tasks (id | status | account | output file):
{table}

Rules for your JSON reply (reply with ONE JSON object, no prose, no code fences):
{{"add_nodes": [{{"id": "short_id", "prompt": "self-contained instruction", "account": "any",
  "difficulty": 1, "depends_on": [], "expect": "optional regex that must appear in the reply"}}],
 "handoff": "what is done, what is running, next steps, key decisions",
 "done": false, "final_node": null}}
- Split the goal into small worker tasks (difficulty 1-2). Workers read files by absolute path; to pass a
  long result use {{{{file:<id>}}}} inside a prompt, a short one {{{{<id>}}}}.
- account must be "any", "clp" or "cop" unless the user asked for a specific account.
- Never repeat an id that already exists. Add at most {max_add} nodes per episode.
- When every needed task is ok, add one final node that merges the results into ONE document, and on the
  NEXT episode (after it is ok) set "done": true and "final_node" to its id.
"""


PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "add_nodes": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string"}, "prompt": {"type": "string"}, "account": {"type": "string"},
            "difficulty": {"type": "integer"}, "depends_on": {"type": "array", "items": {"type": "string"}},
            "expect": {"type": "string"}}, "required": ["id", "prompt"]}},
        "handoff": {"type": "string"},
        "done": {"type": "boolean"},
        "final_node": {"type": ["string", "null"]},
    },
    "required": ["add_nodes", "handoff", "done"],
}


class Lead:
    def __init__(self, sched: en.Scheduler, goal: str, succession: List[str], lead_budget: Optional[int],
                 simulate_crash: Optional[str], max_episodes: int, per_episode: int, log):
        self.s, self.goal, self.log = sched, goal, log
        self.succession = succession
        self.lead_budget, self.simulate_crash = lead_budget, simulate_crash
        self.crashed_once = False
        self.max_episodes, self.per_episode = max_episodes, per_episode
        self.stint_tokens = 0

    @property
    def state(self) -> Dict:
        return self.s.state

    def handoff_path(self):
        return self.s.rd.path / "handoff.md"

    def table(self) -> str:
        rows = []
        for nid, ns in self.state["nodes"].items():
            rows.append(f"{nid} | {ns['status']} | {ns.get('account', '-')} | {self.s.rd.out / (nid + '.md')}"
                        + (f" | reason: {ns.get('reason')}" if ns.get("reason") else ""))
        return "\n".join(rows) or "(none yet)"

    def next_leader(self, current: Optional[str], exclude: List[str]) -> Optional[str]:
        """Succession list order; otherwise ready accounts, same CLI first, then the other CLI."""
        pool = self.s.pool
        order = self.succession or sorted(pool.allowed, key=lambda a: (
            current is not None and mc.cli_of(a) != mc.cli_of(current), a))
        if current in order:
            i = order.index(current)
            order = order[i + 1:] + order[:i + 1]
        for a in order:
            if a in pool.allowed and pool.usable(a) and a not in exclude:
                return a
        return None

    def switch(self, frm: Optional[str], kind: str, reason: str, exclude: List[str]) -> Optional[str]:
        to = self.next_leader(frm, exclude)
        rec = {"from": frm, "to": to, "kind": kind, "reason": reason, "ts": mc.now_iso()}
        self.state["leader"]["history"].append(rec)
        self.state["leader"]["current"] = to
        self.s.event("lead_switch", **{"from": frm, "to": to}, kind=kind, reason=reason)
        self.log(f"lead_switch [{kind}] {frm} -> {to}: {reason}")
        self.stint_tokens = 0
        return to

    def checkpoint(self, text: str) -> None:
        self.handoff_path().write_text(f"# Handoff ({mc.now_iso()}, leader {self.state['leader']['current']})\n\n"
                                       f"{text.strip()}\n", encoding="utf-8")
        self.state["last_checkpoint"] = mc.now_iso()
        self.s.rd.save(self.state)

    def call_leader(self, acct: str, ep: int) -> Dict:
        handoff = self.handoff_path().read_text(encoding="utf-8") if self.handoff_path().exists() else "(none — first episode)"
        prompt = LEAD_PROMPT.format(ep=ep, run_id=self.s.rd.run_id, goal=self.goal, handoff=handoff,
                                    table=self.table(), max_add=max(self.per_episode * 2, 3))
        if not self.s.take_invocation():
            return {"ok": False, "status": "budget", "error": "max invocations reached", "usage": {}}
        kw = dict(difficulty=2, timeout_s=self.s.timeout_s, run_id=self.s.rd.run_id, node=f"lead.ep{ep}",
                  run_dir=self.s.rd.path, cwd=str(self.s.rd.path))
        if mc.cli_of(acct) == "claude":
            rec = clp.invoke(acct, prompt, add_dir=str(self.s.rd.path), json_schema=json.dumps(PLAN_SCHEMA), **kw)
            if isinstance(rec.get("structured_output"), dict):
                rec["result"] = json.dumps(rec["structured_output"])
            return rec
        return cop.invoke(acct, prompt, **kw)

    def apply_plan(self, plan: Dict) -> int:
        added = 0
        for raw in plan.get("add_nodes") or []:
            if not isinstance(raw, dict) or raw.get("id") in self.state["nodes"]:
                continue
            node = {k: raw[k] for k in ("id", "prompt", "account", "difficulty", "depends_on", "expect", "kind")
                    if k in raw}
            try:
                trial = [ns["spec"] for ns in self.state["nodes"].values()] + [node]
                gr._validate(trial)   # same validation as user graphs (ids, accounts, deps, cycles)
            except mc.SkillError as e:
                self.log(f"leader node rejected: {e}")
                continue
            self.state["nodes"][node["id"]] = {"spec": node, "status": "pending", "added_by": self.state["leader"]["current"]}
            added += 1
        self.s.rd.save(self.state)
        return added

    def run(self, first: str) -> Dict:
        lead = first
        self.state["leader"]["current"] = lead
        self.s.event("lead_start", to=lead)
        ep = 0
        while ep < self.max_episodes and lead:
            ep += 1
            self.log(f"episode {ep}: leader {lead}")
            dispatched_before = any(ns["status"] != "pending" for ns in self.state["nodes"].values())
            if self.simulate_crash == lead and not self.crashed_once and dispatched_before:
                self.crashed_once = True
                self.log(f"SIMULATED crash of leader {lead} mid-run (rolling back to last checkpoint)")
                lead = self.switch(lead, "reactive", "simulated crash (--simulate-crash)", [lead])
                continue
            rec = self.call_leader(lead, ep)
            self.stint_tokens += en.tokens_of(rec)
            if not rec.get("ok"):
                if rec.get("status") in ("rate_limit", "auth"):
                    self.s.pool.limited[lead] = rec["status"]
                    self.log(f"STOP: leader {lead} hit {rec['status']} — no failover by policy")
                    return {"stopped": f"leader {lead} {rec['status']}: {mc.short(rec.get('error'), 120)}"}
                if rec.get("status") == "budget":
                    return {"stopped": "max invocations reached"}
                lead = self.switch(lead, "reactive", f"episode failed: {rec.get('status')}", [lead])
                continue
            plan = parse_plan(rec.get("result", ""))
            if plan is None:
                lead = self.switch(lead, "reactive", "leader reply was not valid JSON (rolled back)", [lead])
                continue
            self.checkpoint(str(plan.get("handoff") or ""))
            if plan.get("done") and plan.get("final_node") in self.state["nodes"] \
                    and self.state["nodes"][plan["final_node"]]["status"] == "ok":
                return {"done": True, "final_node": plan["final_node"]}
            added = self.apply_plan(plan)
            self.log(f"leader {lead} added {added} node(s); checkpoint written")
            if self.over_budget(lead):
                lead = self.switch(lead, "proactive", f"lead token budget exceeded ({self.stint_tokens} > {self.lead_budget})", [lead])
                if not lead:
                    break
            self.s.plan()
            self.s.run(stop_after=self.per_episode)
        if not lead:
            return {"stopped": "no usable successor leader"}
        return {"stopped": f"max episodes ({self.max_episodes}) reached"}

    def over_budget(self, lead: str) -> bool:
        return self.lead_budget is not None and self.stint_tokens > self.lead_budget


def parse_plan(text: str) -> Optional[Dict]:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    m = re.search(r"\{.*\}", t, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except ValueError:
        return None
    return d if isinstance(d, dict) else None
