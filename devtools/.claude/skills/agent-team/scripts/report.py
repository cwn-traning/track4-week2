"""Tables for agent-team: run summary, status, ledger statistics and quotas."""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Dict, List, Optional

import macore as mc
import clp
import cop

TOKEN_KEYS = ("input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens")


def quotas(accounts: List[str]) -> List[Dict]:
    return [clp.quota(a) if mc.cli_of(a) == "claude" else cop.quota(a) for a in accounts]


def quota_line(q: Dict) -> str:
    if not q.get("available"):
        return q.get("note", "no data")
    return "; ".join(f"{w['window']}: {w['used_percent']}%" for w in q["windows"])


def quota_table(qs: List[Dict]) -> str:
    return mc.fmt_table(["account", "quota", "as_of"], [[q["account"], quota_line(q), q.get("as_of")] for q in qs])


def node_rows(state: Dict) -> List[List]:
    rows = []
    for nid, ns in state["nodes"].items():
        me = f"{ns.get('model') or '-'}/{ns.get('effort') or '-'}"
        rows.append([nid, ns.get("account", "-"), me, ns.get("duration_s", ""), ns.get("input_tokens", ""),
                     ns.get("output_tokens", ""), ns["status"] + (f" ({ns['reason']})" if ns.get("reason") else "")])
    return rows


def summary_text(rd, state: Dict, qs: List[Dict], extra: Optional[Dict]) -> str:
    parts = [f"\n=== run {rd.run_id} summary ===",
             mc.fmt_table(["node", "account", "model/effort", "time_s", "input_tok", "output_tok", "status"],
                          node_rows(state))]
    hist = state.get("leader", {}).get("history", [])
    if hist:
        parts += ["\nLeader switches:", mc.fmt_table(["from", "to", "kind", "reason"],
                                                     [[h["from"], h["to"], h["kind"], h["reason"]] for h in hist])]
    moves = [e for e in state.get("events", []) if e["event"] == "worker_switch"]
    if moves:
        parts += ["\nWorker task moves:", mc.fmt_table(["node", "from", "to", "reason"],
                                                       [[e["node"], e["from"], e["to"], e["reason"]] for e in moves])]
    rows = by_account(read_ledger(rd.run_id))
    if rows:
        parts += ["\nPer-account stats (this run):", stats_table(rows)]
    if qs:
        parts += ["\nQuota (as of):", quota_table(qs)]
    if extra:
        parts.append("\nResult: " + json.dumps(extra, ensure_ascii=False))
    parts.append(f"Run dir: {rd.path}")
    return "\n".join(parts)


def summary_json(rd, state: Dict, qs: List[Dict], extra: Optional[Dict]) -> Dict:
    return {"run_id": rd.run_id, "run_dir": str(rd.path), "result": extra or {},
            "nodes": {k: {x: v.get(x) for x in ("status", "reason", "account", "model", "effort", "duration_s",
                                                 "input_tokens", "output_tokens")} for k, v in state["nodes"].items()},
            "leader_history": state.get("leader", {}).get("history", []),
            "worker_switches": [e for e in state.get("events", []) if e["event"] == "worker_switch"],
            "quota": qs}


def status_text(rd, state: Dict, qs: Optional[List[Dict]]) -> str:
    accts = sorted(set(state.get("accounts", {})) | {ns.get("account") for ns in state["nodes"].values()
                                                       if ns.get("account")} - {None})
    led = by_account(read_ledger(rd.run_id))
    budgets_hit = {e["from"] for e in state.get("events", []) if e["event"] == "worker_switch"}
    lead_now = state.get("leader", {}).get("current")
    qs = quotas(accts) if qs is None else qs
    qmap = {q["account"]: q for q in qs}
    rows = []
    for a in accts:
        run_n = sum(1 for ns in state["nodes"].values() if ns["status"] == "running" and ns.get("account") == a)
        queue = sum(1 for ns in state["nodes"].values() if ns["status"] == "pending" and ns.get("planned") == a)
        role = "leader" if a == lead_now else ("worker" if any(ns.get("account") == a for ns in state["nodes"].values()) else "-")
        ready = (state.get("accounts", {}).get(a) or {}).get("ready_state")
        failed_limit = any(ns.get("account") == a and str(ns.get("reason", "")).startswith(("rate_limit", "auth"))
                           for ns in state["nodes"].values())
        q = qmap.get(a)
        sess = q.get("session_used_percent") if q and q.get("available") else None
        if ready not in (None, "ready") or failed_limit:
            label = "unusable"
        elif a in budgets_hit:
            label = "not accepting work"
        elif sess is not None and sess >= 80:
            label = "near limit"
        else:
            label = "ready"
        tok = int(led.get(a, {}).get("tokens_total", 0))
        qtxt = (quota_line(q) + f" @ {q.get('as_of')}") if q else "-"
        rows.append([a, role, run_n, queue, tok, qtxt, label])
    return (f"run {rd.run_id} — goal: {state.get('goal') or '-'}\n" +
            mc.fmt_table(["account", "role", "running", "queued", "tokens(run)", "quota (as of)", "state"], rows) +
            "\n\n" + mc.fmt_table(["node", "account", "model/effort", "time_s", "input_tok", "output_tok", "status"],
                                  node_rows(state)))


def read_ledger(run_id: Optional[str] = None) -> List[Dict]:
    f = mc.team_home() / "ledger.jsonl"
    rows = []
    if not f.exists():
        return rows
    for line in f.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("event"):          # switch events are not calls
            continue
        if run_id is None or r.get("run_id") == run_id:
            rows.append(r)
    return rows


def _agg(rows: List[Dict], key) -> Dict[str, Dict]:
    out: Dict[str, Dict] = defaultdict(lambda: defaultdict(float))
    for r in rows:
        g = out[str(key(r))]
        g["calls"] += 1
        g["ok"] += 1 if r.get("status") == "ok" else 0
        for k in TOKEN_KEYS:
            g[k] += int(r.get(k) or 0)
        g["tokens_total"] += sum(int(r.get(k) or 0) for k in TOKEN_KEYS)
        g["cost_usd"] += float(r.get("cost_usd") or 0)
        g["duration_s"] += float(r.get("duration_s") or 0)
    return out


def by_account(rows: List[Dict]) -> Dict[str, Dict]:
    return _agg(rows, lambda r: r.get("account"))


def stats_table(groups: Dict[str, Dict]) -> str:
    rows = []
    for k, g in sorted(groups.items()):
        n = int(g["calls"])
        rows.append([k, n, int(g["ok"]), n - int(g["ok"])] + [int(g[t]) for t in TOKEN_KEYS] +
                    [f"{g['cost_usd']:.4f}", f"{g['duration_s']:.1f}", f"{g['duration_s'] / n:.1f}" if n else "0"])
    return mc.fmt_table(["key", "calls", "ok", "fail", "input", "cached_in", "cache_write", "output", "reasoning",
                         "cost_usd(list)", "time_s", "avg_s"], rows)


def stats_text(run_id: Optional[str]) -> str:
    rows = read_ledger(run_id)
    if not rows:
        return f"no ledger rows yet ({mc.team_home() / 'ledger.jsonl'})"
    t = _agg(rows, lambda r: "TOTAL")["TOTAL"]
    return "\n".join([
        f"ledger: {mc.team_home() / 'ledger.jsonl'}" + (f" (run {run_id})" if run_id else ""),
        "\nBy account:", stats_table(by_account(rows)),
        "\nBy model:", stats_table(_agg(rows, lambda r: f"{r.get('cli')}:{r.get('model')}/{r.get('effort')}")),
        "\nBy run:", stats_table(_agg(rows, lambda r: r.get("run_id") or "(direct)")),
        f"\nTOTAL calls={int(t['calls'])} tokens={int(t['tokens_total'])} cost_usd(list)={t['cost_usd']:.4f}",
    ])
