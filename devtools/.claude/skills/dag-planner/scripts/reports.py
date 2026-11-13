"""reports.py — PLAN.md (planned schedule + AT-QUEST reasons) and REPORT.md (actual vs plan)."""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

import render as rn
import runner as ru


def _table(headers: List[str], rows: List[List]) -> str:
    cell = lambda v: str("" if v is None else v).replace("|", "\\|").replace("\n", " ")
    return "\n".join(["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)] +
                     ["| " + " | ".join(cell(c) for c in r) + " |" for r in rows])


def plan_md(doc: Dict, plan: Dict, labels: Dict[str, str]) -> str:
    by = {b["id"]: b for b in doc["blocks"]}
    m = plan["metrics"]
    rows = []
    for bid, r in plan["blocks"].items():
        b = by[bid]
        if r["status"] != "planned":
            rows.append([bid, b["title"], b["skill"], labels[bid], "UNASSIGNED", "-", "-", r["why"]])
            continue
        who = ", ".join(f"{p['role']}={p['account']}" for p in r["roles"])
        why = " / ".join(f"{p['account']}: {p['why']}" for p in r["roles"])
        rows.append([bid, b["title"], b["skill"], labels[bid], who, r["start"], r["end"], why])
    acc = _table(["account", "eligible", "reason", "headroom %", "slots", "hours to expiry", "U", "expiry"],
                 [[q["account"], q["eligible"], q["reason"] or "-", q.get("headroom"), q.get("slots"),
                   q.get("hours_left"), q.get("use_first"),
                   ("UNKNOWN → 7 d default" if q.get("expiry_unknown") else q.get("expires"))] for q in plan["accounts"]])
    util = ", ".join(f"{a} {v:.0%}" for a, v in m["utilization"].items()) or "-"
    return f"""# PLAN — {plan['name']}

Goal: {plan['goal']}

Status: **{plan['status']}** · planned at {plan['clock']['now']} ({'fixed clock' if plan['clock']['fixed'] else 'wall clock'})
· quota: {plan['quota_source']}{' — ASSUMED values, not real quota' if plan['assumed_quota'] else ''}
· limits: max agents {plan['limits']['max_agents']}, per account {plan['limits']['per_account']}

## Metrics (planned, simulated minutes)

- Makespan: {m['makespan_min']} min · critical path ({' → '.join(plan['critical_path'])}): {m['critical_path_min']} min
- Peak concurrent agents: {m['peak_agents']} · utilisation: {util}
- Schedule is a greedy AT-QUEST list schedule — feasible and validated, not proven optimal.

## Accounts (hard constraints before scoring)

{acc}

## Blocks

{_table(['block', 'title', 'skill', 'model/effort', 'accounts', 'start', 'end', 'AT-QUEST reason'], rows)}

Files: `dag.svg` · `gantt-plan.svg` (+ .png when Chromium exists) · `plan.json` (canonical data for DAG, Gantt and export)
"""


def compare_rows(plan: Dict, bars: List[Dict], status: Dict[str, Dict]) -> List[Dict]:
    rows = []
    for bid, r in plan["blocks"].items():
        mine = [b for b in bars if b["block"] == bid]
        row = {"block": bid, "plan_start": r.get("start", 0), "plan_end": r.get("end", 0), "status": status[bid]["status"]}
        if mine:
            row.update(act_start=min(b["start"] for b in mine), act_end=max(b["end"] for b in mine))
        rows.append(row)
    return rows


def write_report(d: Path, doc: Dict, plan: Dict, run: Dict, calib_f: Path) -> Tuple[List[str], str]:
    ids = {b["id"] for b in doc["blocks"]}
    skill = {b["id"]: b["skill"] for b in doc["blocks"]}
    bars = [b for b in ru.actual_bars(run["state"], ids) if b["block"]]
    status = ru.block_status(run["state"], ids)
    tokens = ru.block_tokens(run["ledger"], ids)
    mode = run["meta"]["mode"]
    tag = "SIMULATED" if mode == "simulation" else "REAL"
    files = rn.write_svg(d / "gantt-actual.svg", rn.render_gantt(
        [dict(b) for b in bars], skill, plan["critical_path"], f"Gantt (actual, {tag}) — {plan['name']} · run {run['meta']['run_id']}"))
    files += rn.write_svg(d / "compare.svg", rn.render_compare(
        compare_rows(plan, bars, status), skill, f"Plan vs actual ({tag}) — {plan['name']}"))
    cal = ru.calibrate(plan, doc, bars, mode, calib_f)
    (d / "REPORT.md").write_text(report_md(doc, plan, run, bars, status, tokens, cal), encoding="utf-8")
    files.append(str(d / "REPORT.md"))
    counts: Dict[str, int] = {}
    for s in status.values():
        counts[s["status"]] = counts.get(s["status"], 0) + 1
    return files, f"{tag} run {run['meta']['run_id']}: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))


def report_md(doc, plan, run, bars, status, tokens, cal) -> str:
    mode = run["meta"]["mode"]
    rows = []
    for b in doc["blocks"]:
        bid, pr = b["id"], plan["blocks"][b["id"]]
        mine = [x for x in bars if x["block"] == bid]
        act_min = round(max(x["end"] for x in mine) - min(x["start"] for x in mine), 2) if mine else "-"
        rows.append([bid, b["skill"], "+".join(p["account"] for p in pr["roles"]) or "-",
                     "+".join(status[bid]["accounts"]) or "-", pr.get("duration", "-"), act_min,
                     tokens.get(bid, 0), status[bid]["status"], status[bid]["reason"]])
    act_span = round(max([x["end"] for x in bars] + [0.0]), 2)
    sim_note = ("\n> **SIMULATION** — agent-team ran with `MA_SIMULATE_LIMIT` on every worker: each started node "
                "returns a simulated usage limit, dependants are blocked. Actual minutes are harness wall time, "
                "not model work; nothing here shows that real execution succeeds.\n"
                f"> Real executor invocations caught by shims: {run['meta'].get('real_executor_invocations')}\n"
                if mode == "simulation" else "")
    return f"""# REPORT — {plan['name']}
{sim_note}
Run `{run['meta']['run_id']}` ({mode}) · dir `{run['run_dir']}` · state from `state.json`, tokens from `ledger.jsonl`

- Planned makespan: {plan['metrics']['makespan_min']} min (simulated plan clock)
- Actual span: {act_span} min ({'harness wall time' if mode == 'simulation' else 'wall time'})
- Calibration: {cal}

{_table(['block', 'skill', 'planned accounts', 'actual accounts', 'plan min', 'actual min', 'tokens', 'status', 'reason'], rows)}

Files: `gantt-actual.svg` · `compare.svg` (+ .png when Chromium exists)
"""
