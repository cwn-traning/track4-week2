#!/usr/bin/env python3
"""dagplan.py — split work into blocks, DAG + AT-QUEST Gantt plan, export to agent-team, simulate, report.

  doctor [--check-accounts]
  dag    NAME [--blocks FILE|-]
  plan   NAME [--blocks FILE|-] [--accounts clp1,cop1:40] [--quota-json FILE] [--max-agents N]
              [--per-account N] [--now ISO]
  export NAME
  run    NAME [--real] [--detach]          (default = simulation; --real spends tokens)
  report NAME

Plans live in $DAGPLAN_HOME (default /workspace/plans in the container, ./workspace/plans elsewhere).
Exit: 0 ok · 1 validation error / BLOCKED / failed run · 2 usage error.
"""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True
import argparse  # noqa: E402
import datetime as dt  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import platform  # noqa: E402
import subprocess  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Dict, List, Optional  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blocks as bk  # noqa: E402
import export as ex  # noqa: E402
import atquest as aq  # noqa: E402
import render as rn  # noqa: E402
import reports as rp  # noqa: E402
import runner as ru  # noqa: E402
import schedule as sc  # noqa: E402

PLAN_SCHEMA = "dag-planner/plan@1"


def plans_root() -> Path:
    env = os.environ.get("DAGPLAN_HOME")
    if env:
        return Path(env)
    return Path("/workspace/plans") if Path("/workspace").is_dir() else Path.cwd() / "workspace" / "plans"


def plan_dir(name: str) -> Path:
    return plans_root() / bk.check_plan_name(name)


def jdump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def load_blocks(name: str, src: Optional[str]) -> Dict:
    """--blocks FILE|- imports into the plan folder; otherwise read <plan>/blocks.json."""
    d = plan_dir(name)
    if src:
        text = sys.stdin.read() if src == "-" else Path(src).read_text(encoding="utf-8")
        doc = bk.load_doc(text)
    else:
        doc = bk.load_file(d / "blocks.json")
    doc.setdefault("name", name)
    errs, warns = bk.validate(doc)
    for w in warns:
        print(f"WARN  {w}")
    if errs:
        raise bk.PlanError("blocks.json invalid:\n  - " + "\n  - ".join(errs))
    if src:   # imported only after it validated -> a bad import never overwrites a good plan
        d.mkdir(parents=True, exist_ok=True)
        (d / "blocks.json").write_text(text, encoding="utf-8")
    return doc


def analyse(doc: Dict, base: Optional[Path]) -> Dict:
    deps = bk.declared_deps(doc["blocks"])
    rank = bk.ranks(doc["blocks"], deps)
    crit = bk.critical_path(doc["blocks"], deps, rank)
    labels = {b["id"]: ex.difficulty_label(b["difficulty"], base, b["skill"]) for b in doc["blocks"]}
    return {"deps": deps, "rank": rank, "crit": crit, "labels": labels}


# ---------------------------------------------------------------- commands
def cmd_doctor(a) -> int:
    base = ex.find_base_skills()
    print(f"python      {platform.python_version()} ({sys.executable})")
    print(f"base skills {base or 'NOT FOUND'}  (searched: {', '.join(str(p) for p in ex.candidates())})")
    print(f"png         {rn.find_chromium() or 'no headless Chromium -> SVG only'}")
    print(f"plans       {plans_root()}")
    if base is None:
        return 1
    _, mc = ex.load_modules(base)
    accts = mc.list_accounts("clp") + mc.list_accounts("cop")
    print(f"accounts    {', '.join(accts) or '(none found on this machine)'}  readiness: UNKNOWN (not checked)")
    if a.check_accounts:
        print("check       team.py check (makes a real minimal model call per account) ...")
        subprocess.run([sys.executable, str(base / "agent-team" / "scripts" / "team.py"), "check"], check=False)
    else:
        print("            readiness needs a real model call; add --check-accounts to run `team.py check`")
    return 0


def cmd_dag(a) -> int:
    doc = load_blocks(a.name, a.blocks)
    base = ex.find_base_skills()
    an = analyse(doc, base)
    d = plan_dir(a.name)
    files = rn.write_svg(d / "dag.svg", rn.render_dag(doc, an["rank"], an["crit"], an["labels"]))
    jdump(d / "dag.json", {"schema": "dag-planner/dag@1", "rank": an["rank"], "critical_path": an["crit"],
                           "levels": bk.levels(doc["blocks"], an["deps"]), "deps": an["deps"]})
    print(f"OK {len(doc['blocks'])} blocks · critical path {' → '.join(an['crit'])}")
    print("files: " + ", ".join(files + [str(d / 'dag.json')]))
    return 0


def parse_accounts(spec: str, now: dt.datetime) -> List[Dict]:
    out = []
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        acc, _, left = part.partition(":")
        if not acc.startswith(("clp", "cop")) or not acc[3:].isdigit():
            raise bk.PlanError(f"invalid account {acc!r} (expected clpN or copN)")
        out.append(aq.assumed(acc, float(left) if left else 100.0, now))
    return out


def load_snaps(a, now: dt.datetime) -> Dict:
    if a.quota_json:
        data = json.loads(Path(a.quota_json).read_text(encoding="utf-8"))
        return {"source": f"quota fixture {Path(a.quota_json).name}", "assumed": False, "snaps": data["accounts"]}
    if a.accounts:
        return {"source": "--accounts (assumed quota, no account touched)", "assumed": True,
                "snaps": parse_accounts(a.accounts, now)}
    raise bk.PlanError("plan needs --accounts (assumed what-if) or --quota-json FILE; live quota is not read "
                       "automatically because team.py quota starts each account's CLI")


def cmd_plan(a) -> int:
    doc = load_blocks(a.name, a.blocks)
    base = ex.find_base_skills()
    an = analyse(doc, base)
    now = dt.datetime.fromisoformat(a.now) if a.now else dt.datetime.now().astimezone()
    if now.tzinfo is None:
        now = now.astimezone()
    src = load_snaps(a, now)
    scored = aq.score_accounts(src["snaps"], now, aq.CFG, a.per_account)
    states = aq.make_states(scored)
    calib_f = plans_root() / "calib.json"
    calib = json.loads(calib_f.read_text(encoding="utf-8")) if calib_f.is_file() else {}
    res = sc.simulate(doc["blocks"], states, aq.CFG, a.max_agents, calib)
    slots = {q["account"]: q.get("slots", 0) for q in scored}
    violations = sc.validate_schedule(doc["blocks"], res["blocks"], slots, a.max_agents, scored)
    if violations:
        raise bk.PlanError("internal schedule validation failed:\n  - " + "\n  - ".join(violations))
    plan = build_plan(a, doc, an, now, src, scored, res, calib)
    d = plan_dir(a.name)
    jdump(d / "plan.json", plan)
    files = write_plan_outputs(d, doc, an, plan)
    print(f"{plan['status']} · makespan {plan['metrics']['makespan_min']} min · peak {plan['metrics']['peak_agents']} agents"
          f" · unassigned {plan['metrics']['unassigned_blocks']}")
    print("files: " + ", ".join(files))
    return 0 if plan["status"] == "OK" else 1


def build_plan(a, doc, an, now, src, scored, res, calib) -> Dict:
    m = sc.metrics(doc["blocks"], res["blocks"], an["crit"])
    used = sorted({p["account"] for r in res["blocks"].values() for p in r["roles"]})
    raw = json.dumps(doc, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return {"schema": PLAN_SCHEMA, "name": a.name, "goal": doc.get("goal", ""), "status": "OK" if not m["unassigned_blocks"] else "BLOCKED",
            "clock": {"now": aq.iso(now), "fixed": bool(a.now), "unit": "minutes from plan start"},
            "quota_source": src["source"], "assumed_quota": src["assumed"],
            "limits": {"max_agents": a.max_agents, "per_account": a.per_account},
            "accounts": [{k: q.get(k) for k in ("account", "kind", "eligible", "reason", "headroom", "slots",
                                                "hours_left", "expires", "expiry_unknown", "use_first")} for q in scored],
            "accounts_used": used, "calibration": calib, "blocks_sha256": hashlib.sha256(raw).hexdigest(),
            "rank": an["rank"], "critical_path": an["crit"], "effective_deps": res["effective_deps"],
            "blocks": res["blocks"], "rounds": res["rounds"], "metrics": m}


def plan_bars(plan: Dict) -> List[Dict]:
    return [{"block": bid, "role": p["role"], "account": p["account"], "start": r["start"], "end": r["end"], "status": "planned"}
            for bid, r in plan["blocks"].items() if r["status"] == "planned" for p in r["roles"]]


def write_plan_outputs(d: Path, doc: Dict, an: Dict, plan: Dict) -> List[str]:
    skill = {b["id"]: b["skill"] for b in doc["blocks"]}
    accts = {bid: "+".join(p["account"] for p in r["roles"]) or "UNASSIGNED" for bid, r in plan["blocks"].items()}
    files = rn.write_svg(d / "dag.svg", rn.render_dag(doc, an["rank"], an["crit"], an["labels"], accts,
                                                     f"DAG + accounts — {plan['name']}"))
    files += rn.write_svg(d / "gantt-plan.svg", rn.render_gantt(plan_bars(plan), skill, an["crit"],
                                                                f"Gantt (plan) — {plan['name']} · AT-QUEST"))
    (d / "PLAN.md").write_text(rp.plan_md(doc, plan, an["labels"]), encoding="utf-8")
    return files + [str(d / "PLAN.md"), str(d / "plan.json")]


def cmd_export(a) -> int:
    d = plan_dir(a.name)
    doc = load_blocks(a.name, None)
    plan = json.loads((d / "plan.json").read_text(encoding="utf-8")) if (d / "plan.json").is_file() else None
    if plan is None:
        raise bk.PlanError("plan.json not found — run `plan` first")
    raw = json.dumps(doc, sort_keys=True, ensure_ascii=False).encode("utf-8")
    if hashlib.sha256(raw).hexdigest() != plan["blocks_sha256"]:
        raise bk.PlanError("blocks.json changed after planning — run `plan` again")
    base = ex.find_base_skills()
    if base is None:
        raise bk.PlanError("base skills not found (agent-team/clp/cop) — cannot validate graph.json")
    app = (d / "app").resolve().as_posix()
    if not app.startswith("/"):   # Windows host: agent-team runs in the container, which sees /workspace/plans
        app = f"/workspace/plans/{a.name}/app"
        print(f"NOTE  host path is not POSIX; node cwd set to container path {app}")
    graph = ex.build_graph(doc, plan, app)
    n = ex.validate_with_agent_team(json.loads(json.dumps(graph)), base)
    jdump(d / "graph.json", graph)
    print(f"OK graph.json accepted by agent-team graph.expand(): {len(graph['nodes'])} nodes → {n} expanded")
    print(f"workers: {','.join(graph['dagplan']['workers'])} · file: {d / 'graph.json'}")
    return 0


def cmd_run(a) -> int:
    base = ex.find_base_skills()
    if base is None:
        raise bk.PlanError("base skills not found")
    d = plan_dir(a.name)
    (d / "app").mkdir(parents=True, exist_ok=True)
    meta = ru.run_plan(d, base, real=a.real, detach=a.detach)
    print(f"{meta['mode']} run {meta.get('run_id') or '(starting, detached pid ' + str(meta.get('pid')) + ')'}"
          f" rc={meta.get('rc')} · log {meta['log']}")
    if meta["mode"] == "simulation" and meta.get("real_executor_invocations"):
        print(f"SIMULATION BOUNDARY VIOLATED: {meta['real_executor_invocations']} real CLI invocation(s) caught")
        return 1
    if meta["mode"] == "simulation":
        print(f"real executor invocations: {meta.get('real_executor_invocations')}")
    return 0 if meta.get("rc") in (0, 1, None) else 1


def cmd_report(a) -> int:
    d = plan_dir(a.name)
    doc = load_blocks(a.name, None)
    plan = json.loads((d / "plan.json").read_text(encoding="utf-8"))
    run = ru.load_run(d)
    files, summary = rp.write_report(d, doc, plan, run, plans_root() / "calib.json")
    print(summary)
    print("files: " + ", ".join(files))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="dagplan.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor").add_argument("--check-accounts", action="store_true")
    for name in ("dag", "plan"):
        p = sub.add_parser(name)
        p.add_argument("name")
        p.add_argument("--blocks", help="blocks.json to import (or - for stdin)")
    pl = sub.choices["plan"]
    pl.add_argument("--accounts", help="clp1,cop1:40 = assumed quota (% left in 5 h); no account is touched")
    pl.add_argument("--quota-json", help="quota snapshot fixture {accounts:[...]}")
    pl.add_argument("--max-agents", type=int, default=8, help="team concurrency (agent-team --max-parallel, default 8)")
    pl.add_argument("--per-account", type=int, default=3, help="slots per account cap (agent-team default 3)")
    pl.add_argument("--now", help="fixed clock ISO-8601 for a reproducible plan")
    for name in ("export", "report"):
        sub.add_parser(name).add_argument("name")
    r = sub.add_parser("run")
    r.add_argument("name")
    r.add_argument("--real", action="store_true", help="REAL execution (spends tokens); default is simulation")
    r.add_argument("--detach", action="store_true")
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):   # Thai text / arrows on Windows consoles
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    a = build_parser().parse_args(argv)
    if getattr(a, "max_agents", 1) < 1 or getattr(a, "per_account", 1) < 1:
        print("ERROR: --max-agents and --per-account must be >= 1", file=sys.stderr)
        return 2
    try:
        return {"doctor": cmd_doctor, "dag": cmd_dag, "plan": cmd_plan, "export": cmd_export,
                "run": cmd_run, "report": cmd_report}[a.cmd](a)
    except bk.PlanError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError) as e:
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
