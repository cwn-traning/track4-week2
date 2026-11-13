#!/usr/bin/env python3
"""agent-team — multi-account team runner over clp (Claude Code) and cop (Codex CLI).

  run FILE|-  [--workers a,b] [--resume RUN_ID [--patch FILE]] [--json]
  lead --goal TEXT [--demo] [--leader A] [--succession a,b] [--lead-token-budget N]
       [--worker-token-budget N|acct=N,..] [--simulate-crash A] [--workers a,b]
  status [RUN_ID]      stats [--run RUN_ID]      quota [--workers a,b]
  check [--workers a,b]      approve RUN_ID NODE
"""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True  # keep shared skill dirs free of __pycache__
import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "clp" / "scripts"))
sys.path.insert(0, str(HERE.parents[1] / "cop" / "scripts"))
import macore as mc  # noqa: E402
import graph as gr  # noqa: E402
import engine as en  # noqa: E402
import leader as ld  # noqa: E402
import clp  # noqa: E402
import cop  # noqa: E402
import report  # noqa: E402

DEMO_GOAL = ("Write a short field guide about 3 tropical fruits (mango, durian, rambutan): one worker writes "
             "each fruit's section (3 bullet facts each), then merge everything into ONE markdown document.")


LOG_STREAM = [sys.stdout]   # switched to stderr with --json so stdout stays pure JSON


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=LOG_STREAM[0], flush=True)


def read_graph(src: str) -> Dict:
    try:
        text = sys.stdin.read() if src == "-" else Path(src).read_text(encoding="utf-8")
        return json.loads(text)
    except (OSError, ValueError) as e:
        raise mc.SkillError(f"cannot read graph JSON from {src}: {e}")


def parse_budgets(v: Optional[str], accounts: List[str]) -> Dict[str, int]:
    if not v:
        return {}
    if "=" not in v:
        return {a: int(v) for a in accounts}
    out = {}
    for part in v.split(","):
        k, _, n = part.partition("=")
        mc.cli_of(k.strip())
        out[k.strip()] = int(n)
    return out


def allowed_accounts(workers: Optional[str], nodes: List[Dict]) -> List[str]:
    """--workers wins; if every node pins an account, only those accounts are touched."""
    if workers:
        accts = [w.strip() for w in workers.split(",") if w.strip()]
        for a in accts:
            mc.cli_of(a)
        return accts
    pinned = set()
    for n in nodes:
        for spec in (n["account"], (n.get("reviewer") or {}).get("account")):
            if spec is None:
                continue
            if spec in gr.SIDES:
                return mc.list_accounts("clp") + mc.list_accounts("cop")
            pinned.add(spec)
    return sorted(pinned)


def make_sched(rd, state, accounts, a) -> en.Scheduler:
    pool = en.Pool(accounts, a.per_account, parse_budgets(a.worker_token_budget, accounts))
    pool.check_ready(log)
    st_accts = state.setdefault("accounts", {})
    for acct in accounts:
        st_accts[acct] = {"ready_state": pool.state.get(acct)}
    return en.Scheduler(rd, state, pool, a.max_parallel, a.max_invocations, a.gate_timeout, log, a.timeout)


def cmd_run(a) -> int:
    if a.resume:
        rd = en.RunDir(a.resume)
        state = rd.load()
        patch = read_graph(a.patch) if a.patch else {}
        for nid, ns in state["nodes"].items():
            if nid in patch:
                ns["spec"].update({k: v for k, v in patch[nid].items() if k in ("prompt", "expect")})
            if ns["status"] != "ok":
                ns.update(status="pending", reason="")
        nodes = [ns["spec"] for ns in state["nodes"].values()]
        log(f"resume {rd.run_id}: rerunning {sum(1 for n in state['nodes'].values() if n['status'] == 'pending')} node(s)")
    else:
        g = read_graph(a.file)
        nodes = gr.expand(g)
        rd = en.RunDir(en.RunDir.new_id())
        rd.init(g, nodes)
        state = rd.load()
        log(f"run {rd.run_id}: {len(nodes)} node(s) — dir {rd.path}")
    sched = make_sched(rd, state, allowed_accounts(a.workers, nodes), a)
    sched.plan()
    sched.run()
    return finish(rd, sched, a)


def finish(rd, sched, a, extra: Optional[Dict] = None) -> int:
    state = sched.state
    state["finished"] = mc.now_iso()
    rd.save(state)
    used = sorted({ns.get("account") for ns in state["nodes"].values() if ns.get("account")})
    quotas = [] if a.no_quota else report.quotas(used)
    bad = [n for n, ns in state["nodes"].items() if ns["status"] != "ok"]
    rc = 1 if bad or (extra or {}).get("stopped") else 0
    if a.json:
        print(json.dumps(dict(report.summary_json(rd, state, quotas, extra), exit=rc), indent=1, ensure_ascii=False))
    else:
        print(report.summary_text(rd, state, quotas, extra))
        print(f"exit={rc} (0 = every node ok; 1 = some node failed/blocked: {', '.join(bad) or '-'})")
    return rc


def cmd_lead(a) -> int:
    goal = a.goal or (DEMO_GOAL if a.demo else None)
    if not goal:
        raise mc.SkillError("lead needs --goal (or --demo for the built-in example goal)")
    rd = en.RunDir(en.RunDir.new_id())
    g = {"goal": goal, "nodes": []}
    rd.path.mkdir(parents=True, exist_ok=True)
    rd.init(g, [])
    state = rd.load()
    accounts = allowed_accounts(a.workers, [{"account": "any"}])
    sched = make_sched(rd, state, accounts, a)
    ready = [x for x in accounts if sched.pool.usable(x)]
    if not ready:
        raise mc.SkillError("no ready account for the leader")
    succession = [s.strip() for s in a.succession.split(",")] if a.succession else []
    first = a.leader or (succession[0] if succession else ready[0])
    crash, lead_budget = a.simulate_crash, a.lead_token_budget
    if a.demo:
        others = [x for x in ready if x != first]
        crash = crash or (others[0] if others else first)       # 2nd leader crashes mid-run
        lead_budget = 1 if lead_budget is None else lead_budget  # every stint hands off -> proactive switch
        if not sched.pool.budgets:                               # first worker account gets a tiny budget
            sched.pool.budgets = {first: 1}
        sched.pool.per_account = 1     # one task per account at a time -> queued work exists to be moved
        log(f"DEMO: simulate-crash={crash} lead-token-budget={lead_budget} worker-budget={sched.pool.budgets} "
            "per-account=1")
    log(f"lead run {rd.run_id}: leader {first}, accounts {ready}")
    lead = ld.Lead(sched, goal, succession, lead_budget, crash, a.max_episodes, a.per_episode, log)
    res = lead.run(first)
    if res.get("final_node"):
        src = rd.out / f"{res['final_node']}.md"
        (rd.out / "FINAL.md").write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        res["final_file"] = str(rd.out / "FINAL.md")
    return finish(rd, sched, a, res)


def latest_run() -> Optional[str]:
    runs = sorted((p for p in mc.team_home().glob("*/state.json")), key=lambda p: p.stat().st_mtime)
    return runs[-1].parent.name if runs else None


def cmd_status(a) -> int:
    rid = a.run_id or latest_run()
    if not rid:
        print(f"no runs yet under {mc.team_home()}")
        return 0
    rd = en.RunDir(rid)
    print(report.status_text(rd, rd.load(), [] if a.no_quota else None))
    return 0


def cmd_simple(a) -> int:
    if a.cmd == "stats":
        print(report.stats_text(a.run))
        return 0
    if a.cmd == "approve":
        rd = en.RunDir(a.run_id)
        if a.node not in rd.load()["nodes"]:
            raise mc.SkillError(f"node {a.node} not in run {a.run_id}")
        (rd.path / "approvals").mkdir(exist_ok=True)
        (rd.path / "approvals" / a.node).write_text(f"approved {mc.now_iso()}\n", encoding="utf-8")
        print(f"approved {a.node} in {a.run_id}")
        return 0
    accts = allowed_accounts(a.workers, [{"account": "any"}])
    if a.cmd == "check":
        res = clp.check([x for x in accts if x.startswith("clp")]) + cop.check([x for x in accts if x.startswith("cop")])
        print(mc.fmt_table(["account", "state", "detail"], [[r["account"], r["state"], r["detail"]] for r in res]))
        return 0
    print(report.quota_table(report.quotas(accts)))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="team.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--workers", help="allow-list, e.g. clp1,cop1 (limits check, quota and dispatch)")
        p.add_argument("--max-parallel", type=int, default=8, help="total concurrent agents (default 8)")
        p.add_argument("--per-account", type=int, default=3, help="concurrent agents per account (default 3)")
        p.add_argument("--max-invocations", type=int, default=20, help="agent calls per run (default 20)")
        p.add_argument("--timeout", type=int, default=mc.DEFAULT_TIMEOUT_S, help="seconds per call (default 180)")
        p.add_argument("--gate-timeout", type=int, default=600)
        p.add_argument("--worker-token-budget", help="N for every account, or clp1=N,cop1=M")
        p.add_argument("--no-quota", action="store_true")
        p.add_argument("--json", action="store_true")

    r = sub.add_parser("run")
    r.add_argument("file", nargs="?", default="-")
    r.add_argument("--resume")
    r.add_argument("--patch", help="JSON {node: {prompt, expect}} applied before resume")
    common(r)
    lp = sub.add_parser("lead")
    lp.add_argument("--goal")
    lp.add_argument("--demo", action="store_true", help="enable crash + proactive + worker-move simulators")
    lp.add_argument("--leader")
    lp.add_argument("--succession")
    lp.add_argument("--lead-token-budget", type=int)
    lp.add_argument("--simulate-crash")
    lp.add_argument("--max-episodes", type=int, default=8)
    lp.add_argument("--per-episode", type=int, default=3, help="worker nodes started per episode")
    common(lp)
    s = sub.add_parser("status")
    s.add_argument("run_id", nargs="?")
    s.add_argument("--no-quota", action="store_true")
    st = sub.add_parser("stats")
    st.add_argument("--run")
    for name in ("quota", "check"):
        sub.add_parser(name).add_argument("--workers")
    ap_ = sub.add_parser("approve")
    ap_.add_argument("run_id")
    ap_.add_argument("node")
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    a = build_parser().parse_args(argv)
    if getattr(a, "json", False):
        LOG_STREAM[0] = sys.stderr
    try:
        mc.guard_not_child()
        if a.cmd == "run":
            return cmd_run(a)
        if a.cmd == "lead":
            return cmd_lead(a)
        if a.cmd == "status":
            return cmd_status(a)
        return cmd_simple(a)
    except mc.SkillError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    os.umask(0o022)
    sys.exit(main())
