"""Shared fixtures for dag-planner tests (deterministic: fixed clock, synthetic accounts)."""
from __future__ import annotations

import copy
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL / "scripts"
FIXTURES = SKILL / "fixtures"
sys.path.insert(0, str(SCRIPTS))
sys.dont_write_bytecode = True

NOW = dt.datetime(2026, 11, 13, 9, 0, tzinfo=dt.timezone(dt.timedelta(hours=7)))
NOW_ISO = NOW.isoformat()


def blk(bid, deps=(), skill="yolo", size="S", **kw):
    b = {"id": bid, "title": f"block {bid}", "size": size, "depends_on": list(deps), "skill": skill,
         "difficulty": 2, "output": kw.pop("output", f"{bid}.png" if skill == "image" else f"{bid}.md"),
         "done": f"{bid} file exists"}
    b.update(kw)
    return b


def doc(*blocks, goal="test goal", name="t"):
    return {"goal": goal, "name": name, "blocks": list(blocks)}


def sample8():
    return json.loads((FIXTURES / "sample8.json").read_text(encoding="utf-8"))


def snap(acc, left=100.0, **kw):
    import atquest as aq
    q = aq.assumed(acc, left, NOW)
    q.update(kw)
    return q


def plan_states(snaps, per_account=3):
    import atquest as aq
    scored = aq.score_accounts(snaps, NOW, aq.CFG, per_account)
    return scored, aq.make_states(scored)


def schedule(d, snaps, max_agents=8, per_account=3):
    import schedule as sc
    import atquest as aq
    scored, states = plan_states(snaps, per_account)
    res = sc.simulate(copy.deepcopy(d["blocks"]), states, aq.CFG, max_agents, {})
    slots = {q["account"]: q.get("slots", 0) for q in scored}
    return res, scored, sc.validate_schedule(d["blocks"], res["blocks"], slots, max_agents)


def cli(args, home, stdin=None, extra_env=None):
    env = dict(os.environ, DAGPLAN_HOME=str(home), DAGPLAN_SIMULATE_ONLY="1", PYTHONDONTWRITEBYTECODE="1",
               PYTHONIOENCODING="utf-8")
    env.update(extra_env or {})
    p = subprocess.run([sys.executable, str(SCRIPTS / "dagplan.py")] + list(args), input=stdin,
                       capture_output=True, text=True, encoding="utf-8", env=env, timeout=600)
    return p.returncode, p.stdout, p.stderr
