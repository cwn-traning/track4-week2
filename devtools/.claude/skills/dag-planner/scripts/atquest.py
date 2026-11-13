"""atquest.py — the AT-QUEST parts of tools/orch.py used for planning (ported, not copied whole).

Ported: score_accounts (U, headroom, slots) · make_state · FACTORS U/F/R/V/L/B · margin · capacity
(with 5 h reset) · choose_account · MRV ordering · reserve_on. Weights, safety, rates, speeds and
sizes are the reference DEFAULT_CFG values; only the account kind names changed (yolo->clp,
cyolo->cop) to match the installed base skills. Not ported: relay / partial hand-off (⑨⑩) because
agent-team cannot move a running node between accounts; worker/infra/postgres code.

All time math takes an explicit `now` (fixed clock for deterministic plans).
"""
from __future__ import annotations

import copy
import datetime as dt
from typing import Dict, List, Optional

CFG = {
    "weights": {"urgency": 0.40, "fit": 0.20, "session": 0.15, "speed": 0.15, "load": -0.10, "bonus": 0.0},
    "speed": {"clp": 1.0, "cop": 0.7},
    "urgency_t0_h": 24,
    "speed_mtok_h": {"clp": 7.2, "cop": 4.8},
    "safety": 1.3,
    "slot_pct": 8,
    "min_margin": 2.0,
    "react_h": 0.25,
    "per_account_max": {"clp": 4, "cop": 3},
    "prior_rate": {"session": {"max": 1.0, "team": 2.0, "pro": 1.0, "default": 2.0},
                   "week": {"max": 0.12, "team": 0.25, "pro": 0.15, "default": 0.25}},
    "default_expiry_h": 168,     # orch.score_accounts: no reset/expiry known -> now + 7 days
}
READY = "ready"


def kind_of(acc: str) -> str:
    return "cop" if acc.startswith("cop") else "clp"


def iso(t: dt.datetime) -> str:
    return t.isoformat(timespec="seconds")


def parse_time(v, now: dt.datetime) -> Optional[dt.datetime]:
    """ISO string, or a number of hours from `now` (fixtures). None = unknown."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return now + dt.timedelta(hours=float(v))
    t = dt.datetime.fromisoformat(str(v))
    return t if t.tzinfo else t.replace(tzinfo=now.tzinfo)


def assumed(acc: str, left: float, now: dt.datetime) -> Dict:
    """planner.assumed(): user-stated headroom (% left in the 5 h window), week reset in 7 days."""
    return {"account": acc, "state": READY, "assumed": True, "plan": "default",
            "session_used": 100 - left, "session_reset": iso(now + dt.timedelta(hours=5)) if left < 100 else None,
            "week_used": 0, "week_reset": iso(now + dt.timedelta(hours=168))}


def _roll_forward(q: Dict, now: dt.datetime) -> None:
    """planner.load_snaps(): a reset time already in the past means that window has reset."""
    for k, used, period in (("week_reset", "week_used", 168), ("session_reset", "session_used", 5)):
        t = parse_time(q.get(k), now)
        if t and t <= now:
            while t <= now:
                t += dt.timedelta(hours=period)
            q[k], q[used] = iso(t), 0


def score_accounts(snaps: List[Dict], now: dt.datetime, cfg: Dict = CFG, per_account: int = 3) -> List[Dict]:
    """Hard constraints first (state, quota known, not expired), then U / headroom / slots.
    Every snapshot gets `eligible` + `reason`; UNKNOWN is never treated as available."""
    out = []
    for raw in sorted(snaps, key=lambda q: q["account"]):
        q = dict(raw, kind=kind_of(raw["account"]))
        _roll_forward(q, now)
        q["eligible"], q["reason"] = _hard_check(q, now)
        if q["eligible"]:
            _soft_scores(q, now, cfg, per_account)
        out.append(q)
    return out


def _hard_check(q: Dict, now: dt.datetime):
    state = q.get("state") or "unknown"
    if state != READY:
        return False, f"readiness {state.upper()} (only '{READY}' accounts are used)"
    if q.get("session_used") is None:
        return False, "quota UNKNOWN (no session usage data)"
    exp = parse_time(q.get("plan_expires"), now)
    if exp and exp <= now:
        return False, f"EXPIRED plan ({iso(exp)})"
    return True, ""


def _soft_scores(q: Dict, now: dt.datetime, cfg: Dict, per_account: int) -> None:
    su = float(q.get("session_used") or 0)
    wu = float(q.get("week_used") or 0)
    q["headroom_session"] = max(0.0, 100 - su)
    q["headroom_week"] = max(0.0, 100 - wu)
    q["headroom"] = min(q["headroom_session"], q["headroom_week"])
    exp = [t for t in (parse_time(q.get("week_reset"), now), parse_time(q.get("plan_expires"), now)) if t]
    q["expiry_unknown"] = not exp
    expires = min(exp) if exp else now + dt.timedelta(hours=cfg["default_expiry_h"])
    q["hours_left"] = round(max(1.0, (expires - now).total_seconds() / 3600), 1)
    q["expires"] = iso(expires)
    q["use_first"] = round(cfg["urgency_t0_h"] / (cfg["urgency_t0_h"] + q["hours_left"]), 3)
    cap = min(cfg["per_account_max"][q["kind"]], per_account)
    q["slots"] = 0 if q["headroom"] <= cfg["min_margin"] else max(1, min(cap, int(q["headroom"] // cfg["slot_pct"])))
    sr = parse_time(q.get("session_reset"), now)
    q["sreset_h"] = None if sr is None else max(0.0, (sr - now).total_seconds() / 3600)


def rate_for(q: Dict, window: str, cfg: Dict = CFG) -> float:
    pr = cfg["prior_rate"][window]
    return pr.get(q.get("plan") or "default", pr["default"])


def make_states(scored: List[Dict], cfg: Dict = CFG) -> List[Dict]:
    """orch.make_state for every eligible account (sorted by name -> deterministic)."""
    return [{"account": q["account"], "kind": q["kind"], "rs": rate_for(q, "session", cfg),
             "rw": rate_for(q, "week", cfg), "h_s": q["headroom_session"], "h_w": q["headroom_week"],
             "hours_left": max(1.0, q["hours_left"]), "slots": q["slots"], "used": 0,
             "bonus": float(q.get("bonus", 0) or 0), "sreset_h": q["sreset_h"]}
            for q in scored if q["eligible"]]


FACTORS = {
    # U: expiry urgency = T0 / (T0 + hours until reset/expiry)
    "urgency": lambda s, x: x["cfg"]["urgency_t0_h"] / (x["cfg"]["urgency_t0_h"] + s["hours_left"]),
    # F: best fit — share of the remaining weekly bucket this work uses
    "fit": lambda s, x: min(1.0, x["qw"] / max(s["h_w"], 1e-9)),
    # R: room left in the 5 h window after the work
    "session": lambda s, x: max(0.0, s["h_s"] - x["qs"]) / 100,
    # V: CLI speed x critical-path importance
    "speed": lambda s, x: x["cfg"]["speed"].get(s["kind"], 1.0) * x["crit"],
    # L: current load (negative weight spreads work)
    "load": lambda s, x: s["used"] / max(1, s["slots"]),
    # B: per-account bonus (weight 0 = off)
    "bonus": lambda s, x: s.get("bonus", 0.0),
}


def margin(s: Dict, cfg: Dict, window: str, workers: int = 1) -> float:
    r = s["rs"] if window == "session" else s["rw"]
    return max(cfg["min_margin"], r * cfg["speed_mtok_h"].get(s["kind"], 6.0) * cfg["react_h"] * max(1, workers))


def capacity(s: Dict, cfg: Dict = CFG) -> float:
    """Largest job (M tok) the account can finish without crossing its safety line."""
    sig = cfg["safety"]
    m_s, m_w = margin(s, cfg, "session", s["used"] + 1), margin(s, cfg, "week", s["used"] + 1)
    room_s = max(0.0, s["h_s"] - m_s) / (sig * s["rs"])
    room_w = max(0.0, s["h_w"] - m_w) / (sig * s["rw"])
    sr = s.get("sreset_h")
    if sr is not None:
        before = cfg["speed_mtok_h"].get(s["kind"], 6.0) * sr
        if room_s >= before:
            room_s = before + (100 - m_s) / (sig * s["rs"])
    return min(room_s, room_w)


def choose_account(cost: float, crit: float, states: List[Dict], cfg: Dict = CFG,
                   kind_only: Optional[str] = None, avoid=()) -> List[Dict]:
    """Feasible accounts (cost <= capacity, free slot) ranked by Σ w_i·factor_i. Ties: account name."""
    W, sig, out = cfg["weights"], cfg["safety"], []
    for s in states:
        if (kind_only and s["kind"] != kind_only) or s["account"] in avoid or s["used"] >= s["slots"]:
            continue
        cap = capacity(s, cfg)
        if cap < cost:
            continue
        qs, qw = sig * s["rs"] * cost, sig * s["rw"] * cost
        x = {"qs": qs, "qw": qw, "crit": crit, "cfg": cfg}
        parts = {k: round(FACTORS[k](s, x), 3) for k, w in W.items() if w and k in FACTORS}
        sc = sum(W[k] * v for k, v in parts.items())
        out.append({"account": s["account"], "kind": s["kind"], "score": round(100 * sc, 1),
                    "qs": round(qs, 2), "qw": round(qw, 2), "parts": parts, "cap": round(cap, 2)})
    out.sort(key=lambda o: (-o["score"], o["account"]))
    return out


def reserve_on(states: List[Dict], acc: str, qs: float, qw: float) -> None:
    for s in states:
        if s["account"] == acc:
            s["h_s"] -= qs
            s["h_w"] -= qw
            s["used"] += 1


def release(states: List[Dict], acc: str) -> None:
    for s in states:
        if s["account"] == acc:
            s["used"] -= 1


def clone(states: List[Dict]) -> List[Dict]:
    return copy.deepcopy(states)


def why_text(c: Dict, need: float, cands: List[Dict]) -> str:
    p = " ".join(f"{k}={v}" for k, v in c["parts"].items())
    alt = f" · 2nd {cands[1]['account']} {cands[1]['score']}" if len(cands) > 1 else ""
    return f"AT-QUEST {c['score']} ({p}) · need {need:.2f}M tok ≈ 5h {c['qs']}% / week {c['qw']}%{alt}"
