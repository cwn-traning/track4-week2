"""schedule.py — resource-aware list scheduling of blocks with AT-QUEST, plus an independent validator.

Simulated time is minutes from plan start (t=0); no wall clock is read here.
Multi-account blocks (review / debate / best_of) reserve quota and a slot on every account involved.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import blocks as bk
import atquest as aq

REVIEW_SHARE = 0.3   # dag-planner assumption: reviewer / judge cost = 30 % of the block size (not in orch.py)
MIN_DURATION_MIN = 3.0   # orch/planner: max(dur, 0.05 h)


def roles_of(block: Dict) -> List[Dict]:
    """Accounts a block needs: role, forced CLI kind ('other' = opposite of the worker), cost share."""
    sk = block["skill"]
    if sk == "yolo":
        return [{"role": "worker", "kind": "clp", "share": 1.0}]
    if sk in ("cyolo", "image"):
        return [{"role": "worker", "kind": "cop", "share": 1.0}]
    if sk == "review":
        return [{"role": "worker", "kind": None, "share": 1.0}, {"role": "reviewer", "kind": "other", "share": REVIEW_SHARE}]
    if sk == "debate":
        return [{"role": "answer", "kind": "clp", "share": 1.0}, {"role": "answer", "kind": "cop", "share": 1.0},
                {"role": "judge", "kind": None, "share": REVIEW_SHARE}]
    n = int(block.get("n", bk.BEST_OF_N[0]))
    return [{"role": "answer", "kind": None, "share": 1.0} for _ in range(n)] + \
           [{"role": "judge", "kind": None, "share": REVIEW_SHARE}]


def assign_block(block: Dict, need: float, crit: float, states: List[Dict], cfg: Dict) -> Tuple[Optional[List[Dict]], str]:
    """Try to reserve every role on distinct accounts (all-or-nothing on a copy of the states)."""
    trial, picks = aq.clone(states), []
    for r in roles_of(block):
        kind = r["kind"]
        if kind == "other":
            kind = "cop" if picks[0]["kind"] == "clp" else "clp"
        cost = need * r["share"]
        cands = aq.choose_account(cost, crit, trial, cfg, kind_only=kind, avoid={p["account"] for p in picks})
        if not cands:
            side = {"clp": "Claude (clp)", "cop": "Codex (cop)"}.get(kind, "any")
            return None, f"no {side} account can take role '{r['role']}' ({cost:.2f}M tok) with a free slot"
        best = cands[0]
        aq.reserve_on(trial, best["account"], best["qs"], best["qw"])
        picks.append(dict(best, role=r["role"], need=round(cost, 3), why=aq.why_text(best, cost, cands),
                          alts=[f"{c['account']} {c['score']}" for c in cands[1:3]]))
    states[:] = trial
    return picks, ""


def duration_min(block: Dict, picks: List[Dict], cfg: Dict, calib: Dict) -> float:
    """(slowest primary role + reviewer/judge, which agent-team runs after the work) x learned k."""
    speed = lambda p: cfg["speed_mtok_h"].get(p["kind"], 6.0)
    prim = [p for p in picks if p["role"] in ("worker", "answer")] or picks
    hours = max(p["need"] / speed(p) for p in prim) + sum(p["need"] / speed(p) for p in picks if p not in prim)
    k = float((calib.get(block["skill"]) or {}).get("k", 1.0))
    return round(max(hours * 60 * k, MIN_DURATION_MIN), 1)


class _Sim:
    def __init__(self, blocks: List[Dict], states: List[Dict], cfg: Dict, max_agents: int, calib: Dict):
        self.blocks = sorted(blocks, key=lambda b: b["id"])
        self.by = {b["id"]: b for b in blocks}
        self.deps = bk.effective_deps(blocks)
        self.need = {b["id"]: bk.SIZE_MTOK[b["size"]] for b in blocks}
        rk = bk.ranks(blocks, bk.declared_deps(blocks))
        mx = max(list(rk.values()) + [1e-9])
        self.crit = {k: round(v / mx, 3) for k, v in rk.items()}
        self.states, self.cfg, self.max_agents, self.calib = states, cfg, max_agents, calib
        self.out: Dict[str, Dict] = {}
        self.running: List[Dict] = []
        self.done: set = set()
        self.t = 0.0
        self.rounds: List[Dict] = []

    def ready(self) -> List[Dict]:
        rd = [b for b in self.blocks if b["id"] not in self.out and set(self.deps[b["id"]]) <= self.done]
        if any(self.by[r["id"]].get("exclusive") for r in self.running):
            return []
        busy = {self.by[r["id"]]["output"] for r in self.running}
        return [b for b in rd if b["output"] not in busy and not (b.get("exclusive") and self.running)]

    def order(self, ready: List[Dict]) -> List[Dict]:
        """⑧ MRV: fewest feasible accounts first, then critical rank, then size, then id."""
        def key(b):
            n = len(aq.choose_account(self.need[b["id"]], self.crit[b["id"]], self.states, self.cfg,
                                      kind_only=roles_of(b)[0]["kind"] if roles_of(b)[0]["kind"] != "other" else None))
            return (min(n, 3) if n else 9, -self.crit[b["id"]], -self.need[b["id"]], b["id"])
        return sorted(ready, key=key)

    def start_round(self) -> Tuple[List[str], Dict[str, str]]:
        started, failed = [], {}
        for b in self.order(self.ready()):
            agents = sum(len(r["roles"]) for r in self.running)
            if agents + len(roles_of(b)) > self.max_agents:
                failed[b["id"]] = f"team concurrency limit --max-agents {self.max_agents}"
                continue
            if b["output"] in {self.by[r["id"]]["output"] for r in self.running}:
                continue
            picks, why = assign_block(b, self.need[b["id"]], self.crit[b["id"]], self.states, self.cfg)
            if picks is None:
                failed[b["id"]] = why
                continue
            dur = duration_min(b, picks, self.cfg, self.calib)
            rec = {"id": b["id"], "status": "planned", "start": round(self.t, 1), "end": round(self.t + dur, 1),
                   "duration": dur, "roles": picks}
            self.out[b["id"]] = rec
            self.running.append(rec)
            started.append(b["id"])
            if b.get("exclusive"):
                break
        return started, failed

    def mark_unassigned(self, failed: Dict[str, str]) -> None:
        succ = bk.successors(self.blocks, self.deps)
        for bid, why in sorted(failed.items()):
            self.out[bid] = {"id": bid, "status": "unassigned", "why": why, "roles": []}
            for d in sorted(bk.descendants(bid, succ)):
                self.out.setdefault(d, {"id": d, "status": "unassigned", "why": f"waits on unassigned {bid}", "roles": []})

    def run(self) -> None:
        while len(self.out) < len(self.blocks):
            started, failed = self.start_round()
            if started:
                self.rounds.append({"t_min": round(self.t, 1), "start": started})
            if not self.running:
                if not failed:
                    failed = {b["id"]: "no runnable path (blocked by an unassigned dependency)"
                              for b in self.blocks if b["id"] not in self.out}
                self.mark_unassigned(failed)
                continue
            nxt = min(r["end"] for r in self.running)
            self.t = nxt
            for r in [r for r in self.running if r["end"] <= nxt + 1e-9]:
                self.running.remove(r)
                self.done.add(r["id"])
                for p in r["roles"]:
                    aq.release(self.states, p["account"])


def simulate(blocks: List[Dict], states: List[Dict], cfg: Dict = aq.CFG, max_agents: int = 8,
             calib: Optional[Dict] = None) -> Dict:
    sim = _Sim(blocks, states, cfg, max_agents, calib or {})
    sim.run()
    return {"blocks": {k: sim.out[k] for k in sorted(sim.out)}, "rounds": sim.rounds,
            "effective_deps": sim.deps, "crit_norm": sim.crit}


# ---------------------------------------------------------------- independent validator + metrics
def validate_schedule(blocks: List[Dict], sched: Dict, slots: Dict[str, int], max_agents: int,
                      scored: Optional[List[Dict]] = None) -> List[str]:
    """Re-check a schedule from scratch: completeness, deps, exclusivity, file locks, per-account slots,
    team limit, role/CLI rules and (with `scored`) cumulative quota reservations. [] = valid."""
    errs, by = [], {b["id"]: b for b in blocks}
    if set(sched) != set(by):
        errs.append(f"schedule covers {sorted(set(sched))} but blocks are {sorted(by)}")
    errs += [f"{k}: unassigned without a reason" for k, v in sched.items() if v["status"] != "planned" and not v.get("why")]
    if scored is not None:
        errs += _quota_errors(sched, scored)
    deps = bk.effective_deps(blocks)
    planned = {k: v for k, v in sched.items() if v["status"] == "planned"}
    for bid, r in planned.items():
        errs += _role_errors(by[bid], r)
        for d in deps[bid]:
            if d not in planned or planned[d]["end"] > r["start"] + 1e-9:
                errs.append(f"{bid} starts at {r['start']} before dependency {d} ends")
    errs += _overlap_errors(by, planned, slots, max_agents)
    return errs


def _quota_errors(sched: Dict, scored: List[Dict]) -> List[str]:
    """Sum of reserved 5 h / week % per account must stay within its starting headroom."""
    head = {q["account"]: (q.get("headroom_session", 0), q.get("headroom_week", 0)) for q in scored if q["eligible"]}
    use: Dict[str, List[float]] = {}
    for r in sched.values():
        for p in r["roles"]:
            if p["account"] not in head:
                return [f"{p['account']} is not an eligible account"]
            u = use.setdefault(p["account"], [0.0, 0.0])
            u[0] += p["qs"]
            u[1] += p["qw"]
    return [f"{a}: reserved {u[0]:.1f}%/{u[1]:.1f}% exceeds headroom {head[a]}"
            for a, u in sorted(use.items()) if u[0] > head[a][0] + 1e-6 or u[1] > head[a][1] + 1e-6]


def _role_errors(block: Dict, r: Dict) -> List[str]:
    accts = [p["account"] for p in r["roles"]]
    errs = [] if len(set(accts)) == len(accts) else [f"{block['id']}: same account used for two roles"]
    want = [x["kind"] for x in roles_of(block)]
    if len(want) != len(accts):
        return errs + [f"{block['id']}: expected {len(want)} accounts, got {len(accts)}"]
    for w, a in zip(want, accts):
        if w in ("clp", "cop") and aq.kind_of(a) != w:
            errs.append(f"{block['id']}: {a} is on the wrong CLI (needs {w})")
    if block["skill"] == "review" and aq.kind_of(accts[0]) == aq.kind_of(accts[1]):
        errs.append(f"{block['id']}: reviewer must use the other CLI")
    return errs


def _overlap_errors(by: Dict, planned: Dict, slots: Dict[str, int], max_agents: int) -> List[str]:
    errs = []
    for t in sorted({r["start"] for r in planned.values()}):
        live = [r for r in planned.values() if r["start"] <= t < r["end"]]
        per: Dict[str, int] = {}
        for r in live:
            for p in r["roles"]:
                per[p["account"]] = per.get(p["account"], 0) + 1
        errs += [f"t={t}: {a} runs {n} > {slots.get(a, 0)} slots" for a, n in sorted(per.items()) if n > slots.get(a, 0)]
        if sum(per.values()) > max_agents:
            errs.append(f"t={t}: {sum(per.values())} agents > --max-agents {max_agents}")
        if len(live) > 1 and any(by[r["id"]].get("exclusive") for r in live):
            errs.append(f"t={t}: exclusive block overlaps other work")
        outs = [by[r["id"]]["output"] for r in live]
        if len(outs) != len(set(outs)):
            errs.append(f"t={t}: two running blocks write the same output")
    return errs


def metrics(blocks: List[Dict], sched: Dict, crit_path: List[str]) -> Dict:
    planned = [r for r in sched.values() if r["status"] == "planned"]
    makespan = max([r["end"] for r in planned] + [0.0])
    busy: Dict[str, float] = {}
    for r in planned:
        for p in r["roles"]:
            busy[p["account"]] = busy.get(p["account"], 0.0) + r["duration"]
    peak = 0
    for t in sorted({r["start"] for r in planned}):
        peak = max(peak, sum(len(r["roles"]) for r in planned if r["start"] <= t < r["end"]))
    cp_dur = sum(sched[b]["duration"] for b in crit_path if sched.get(b, {}).get("status") == "planned")
    return {"makespan_min": round(makespan, 1), "critical_path_min": round(cp_dur, 1), "peak_agents": peak,
            "utilization": {a: round(v / makespan, 3) if makespan else 0.0 for a, v in sorted(busy.items())},
            "planned_blocks": len(planned), "unassigned_blocks": len(sched) - len(planned)}
