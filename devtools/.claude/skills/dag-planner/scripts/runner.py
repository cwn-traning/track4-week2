"""runner.py — hand graph.json to agent-team `team.py run` and build the actual-vs-plan report.

Simulation is the default and is enforced at runtime, not by prompt:
  * private AGENT_TEAM_HOME inside the plan (never the shared /workspace/.agent-team)
  * synthetic ready_cache.json in that private home (team.py then makes no readiness call)
  * MA_SIMULATE_LIMIT = every worker -> clp/cop return a simulated usage limit without a process
  * PATH starts with counting shims for clp1-9, cop1-9, claude, codex and drops /usr/local/bin,
    so any real CLI invocation is caught and counted instead of executed
The run is accepted only if the shim counter is 0.
Real execution needs --real and is refused when DAGPLAN_SIMULATE_ONLY=1.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import blocks as bk

SHIM_NAMES = [f"{p}{n}" for p in ("clp", "cop") for n in range(1, 100)] + ["claude", "codex"]   # macore ACCOUNT_RE: 1-99
SAFE_PATH = "/usr/sbin:/usr/bin:/sbin:/bin"
RUN_ID_RE = re.compile(r"run (\d{8}-\d{6}-\d{3})")


def _write_shims(shim_dir: Path, log: Path) -> None:
    shim_dir.mkdir(parents=True, exist_ok=True)
    body = f'#!/bin/sh\necho "$(basename "$0")" >> {shlex.quote(str(log))}\nexit 97\n'
    for n in SHIM_NAMES:
        p = shim_dir / n
        p.write_text(body, encoding="utf-8")
        p.chmod(0o755)


def sim_env(sandbox: Path, workers: List[str]) -> Dict[str, str]:
    home, shim, log = sandbox / "agent-team-home", sandbox / "shim", sandbox / "real_executor_calls.log"
    home.mkdir(parents=True, exist_ok=True)
    log.write_text("", encoding="utf-8")
    _write_shims(shim, log)
    cache = {a: {"state": "ready", "t": time.time(), "synthetic": "dag-planner simulation"} for a in workers}
    (home / "ready_cache.json").write_text(json.dumps(cache), encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("AGENT_TEAM_CHILD",)}
    env.update(AGENT_TEAM_HOME=str(home), MA_SIMULATE_LIMIT=",".join(workers),
               PATH=f"{shim}:{SAFE_PATH}", DAGPLAN_MODE="simulation", PYTHONDONTWRITEBYTECODE="1")
    return env


def shim_count(sandbox: Path) -> int:
    log = sandbox / "real_executor_calls.log"
    return len([x for x in log.read_text(encoding="utf-8").splitlines() if x.strip()]) if log.is_file() else 0


def run_plan(plan_dir: Path, base: Path, real: bool = False, detach: bool = False) -> Dict:
    graph_f = plan_dir / "graph.json"
    if not graph_f.is_file():
        raise bk.PlanError("graph.json not found — run `export` first")
    meta_g = json.loads(graph_f.read_text(encoding="utf-8"))["dagplan"]
    plan = json.loads((plan_dir / "plan.json").read_text(encoding="utf-8"))
    if meta_g["plan_sha256"] != plan["blocks_sha256"]:
        raise bk.PlanError("graph.json is stale (blocks re-planned since export) — run `export` again")
    workers = meta_g["workers"]
    if not workers:
        raise bk.PlanError("graph.json lists no workers")
    lim = meta_g["limits"]
    team = base / "agent-team" / "scripts" / "team.py"
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    argv = [sys.executable, str(team), "run", str(graph_f), "--workers", ",".join(workers), "--json",
            "--max-parallel", str(lim["max_agents"]), "--per-account", str(lim["per_account"])]
    if not real and (os.name != "posix" or detach):
        raise bk.PlanError("simulation needs a POSIX host (container) and runs in the foreground so the "
                           "real-executor counter can be verified")
    if real:
        if os.environ.get("DAGPLAN_SIMULATE_ONLY") == "1":
            raise bk.PlanError("real execution refused: DAGPLAN_SIMULATE_ONLY=1 (simulation-only session)")
        env, sandbox, home = dict(os.environ), None, Path(os.environ.get("AGENT_TEAM_HOME", "/workspace/.agent-team"))
    else:
        sandbox = plan_dir / "sim" / stamp
        env = sim_env(sandbox, workers)
        home = Path(env["AGENT_TEAM_HOME"])
        argv.append("--no-quota")
    log_f = plan_dir / f"run-{stamp}.log"
    meta = {"mode": "real" if real else "simulation", "started": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "agent_team_home": str(home), "workers": workers, "log": str(log_f), "argv": argv[1:]}
    if detach:
        with open(log_f, "w", encoding="utf-8") as lf:
            p = subprocess.Popen(argv, stdout=lf, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        meta.update(pid=p.pid, detached=True)
    else:
        meta.update(_run_foreground(argv, env, log_f))
    if sandbox is not None:
        meta["sandbox"] = str(sandbox)
        meta["real_executor_invocations"] = shim_count(sandbox) if not detach else None
    (plan_dir / "run.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    return meta


def _run_foreground(argv: List[str], env: Dict[str, str], log_f: Path) -> Dict:
    p = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", env=env, timeout=3600)
    log_f.write_text(p.stderr + "\n--- stdout ---\n" + p.stdout, encoding="utf-8")
    try:
        res = json.loads(p.stdout)
    except ValueError:
        res = {}
    m = RUN_ID_RE.search(p.stderr or "")
    return {"rc": p.returncode, "run_id": res.get("run_id") or (m.group(1) if m else None), "finished": True}


# ---------------------------------------------------------------- report
def load_run(plan_dir: Path) -> Dict:
    f = plan_dir / "run.json"
    if not f.is_file():
        raise bk.PlanError("run.json not found — run `run` first")
    meta = json.loads(f.read_text(encoding="utf-8"))
    if not meta.get("run_id"):
        m = RUN_ID_RE.search(Path(meta["log"]).read_text(encoding="utf-8")) if Path(meta["log"]).is_file() else None
        meta["run_id"] = m.group(1) if m else None
    if not meta.get("run_id"):
        raise bk.PlanError("run id unknown yet (detached run still starting?)")
    rd = Path(meta["agent_team_home"]) / meta["run_id"]
    state = json.loads((rd / "state.json").read_text(encoding="utf-8"))
    led = rd / "ledger.jsonl"
    ledger = [json.loads(x) for x in led.read_text(encoding="utf-8").splitlines() if x.strip()] if led.is_file() else []
    return {"meta": meta, "state": state, "ledger": ledger, "run_dir": str(rd)}


def block_of(node_id: str, ids: set) -> Optional[str]:
    if node_id in ids:
        return node_id
    for sep in ("__", "."):
        head = node_id.split(sep)[0]
        if head in ids:
            return head
    return None


def _ts(s: Optional[str]) -> Optional[dt.datetime]:
    return dt.datetime.fromisoformat(s) if s else None


def actual_bars(state: Dict, ids: set) -> List[Dict]:
    """One bar per agent-team node with both start and finish timestamps (minutes from first start)."""
    rows = [(nid, ns) for nid, ns in state["nodes"].items() if ns.get("started") and ns.get("finished")]
    if not rows:
        return []
    t0 = min(_ts(ns["started"]) for _, ns in rows)
    out = []
    for nid, ns in sorted(rows):
        s = (_ts(ns["started"]) - t0).total_seconds() / 60
        e = max((_ts(ns["finished"]) - t0).total_seconds() / 60, s + 0.05)
        out.append({"block": block_of(nid, ids), "node": nid, "role": None if nid in ids else nid.split("__")[-1],
                    "account": ns.get("account") or "-", "start": round(s, 2), "end": round(e, 2), "status": ns["status"]})
    return out


def block_tokens(ledger: List[Dict], ids: set) -> Dict[str, int]:
    keys = ("input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens")
    tok: Dict[str, int] = {}
    for r in ledger:
        b = block_of(str(r.get("node") or ""), ids)
        if b:
            tok[b] = tok.get(b, 0) + sum(int(r.get(k) or 0) for k in keys)
    return tok


def block_status(state: Dict, ids: set) -> Dict[str, Dict]:
    """Block status = agent-team status of the node with the block id (the judge for debate/best_of)."""
    out = {}
    for bid in ids:
        ns = state["nodes"].get(bid, {})
        accts = sorted({s.get("account") for n, s in state["nodes"].items() if block_of(n, ids) == bid and s.get("account")})
        out[bid] = {"status": ns.get("status", "missing"), "reason": ns.get("reason", ""), "accounts": accts,
                    "duration_s": ns.get("duration_s")}
    return out


def calibrate(plan: Dict, doc: Dict, bars: List[Dict], mode: str, calib_f: Path) -> Dict:
    """k = actual / planned minutes per skill, from ok blocks of REAL runs only (simulated timings are
    not real work and would corrupt the learned factor)."""
    if mode != "real":
        return {"written": False, "why": "simulation run — calibration not updated"}
    skill = {b["id"]: b["skill"] for b in doc["blocks"]}
    act: Dict[str, float] = {}
    for b in bars:
        if b["status"] == "ok" and b["block"]:
            act[b["block"]] = max(act.get(b["block"], 0.0), b["end"] - b["start"])
    agg: Dict[str, List[float]] = {}
    for bid, a in act.items():
        pl = plan["blocks"][bid].get("duration") or 0
        if pl > 0:
            agg.setdefault(skill[bid], [0.0, 0.0])
            agg[skill[bid]][0] += a
            agg[skill[bid]][1] += pl
    if not agg:
        return {"written": False, "why": "no completed blocks with timings"}
    cal = json.loads(calib_f.read_text(encoding="utf-8")) if calib_f.is_file() else {}
    for sk, (a, p) in agg.items():
        cal[sk] = {"k": round(a / p, 3), "updated": dt.datetime.now().astimezone().isoformat(timespec="seconds")}
    calib_f.write_text(json.dumps(cal, indent=1), encoding="utf-8")
    return {"written": True, "k": {k: v["k"] for k, v in cal.items()}}
