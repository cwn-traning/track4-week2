#!/usr/bin/env python3
"""clp — Claude Code multi-account adapter (clp1..clpN). Stdlib only, Python 3.8+.

Commands:
  run    --account clpN [--difficulty D | --model M --effort E] [--json-schema S] [--cwd DIR] PROMPT
  check  [--accounts clp1,clp2]        real minimal call (haiku/low) per account
  quota  [--accounts ...]              built-in /usage (no model call)
  accounts                             list accounts that have a wrapper
"""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True  # keep shared skill dirs free of __pycache__
import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import macore as mc  # noqa: E402

CHECK_PROMPT = "Reply with exactly: OK"


def resolve_model(difficulty: Optional[int], model: Optional[str], effort: Optional[str]):
    d = mc.DIFFICULTY.get(difficulty or 1)
    if d is None:
        raise mc.SkillError(f"difficulty must be 1..6, got {difficulty}")
    m = model or d[0]
    e = effort or d[1]
    if e not in mc.CLAUDE_EFFORTS:
        raise mc.SkillError(f"invalid claude effort '{e}' (allowed: {', '.join(mc.CLAUDE_EFFORTS)})")
    if not re.match(r"^[A-Za-z0-9._\-\[\]]+$", m):
        raise mc.SkillError(f"invalid model name '{m}'")
    return m, e


def build_argv(account: str, prompt: str, model: str, effort: str,
               json_schema: Optional[str], add_dir: Optional[str], allow_edits: bool) -> List[str]:
    # prompt directly after -p, before any variadic flag (spec: variadic flags swallow the prompt)
    argv = [account, "-p", prompt, "--model", model, "--effort", effort,
            "--output-format", "json", "--no-session-persistence", "--strict-mcp-config"]
    if json_schema:
        argv += ["--json-schema", json_schema]
    if allow_edits:
        argv += ["--permission-mode", "acceptEdits"]
    # child agents must not spawn sub-agents (max delegation depth = 1)
    argv += ["--disallowedTools", "Agent", "Task"]
    if add_dir:
        argv += ["--add-dir", add_dir]
    return argv


def parse_output(out: str) -> Dict:
    try:
        return json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
    except (ValueError, IndexError):
        return {}


def invoke(account: str, prompt: str, difficulty: Optional[int] = 1, model: Optional[str] = None,
           effort: Optional[str] = None, json_schema: Optional[str] = None, cwd: Optional[str] = None,
           timeout_s: int = mc.DEFAULT_TIMEOUT_S, run_id: Optional[str] = None, node: Optional[str] = None,
           run_dir: Optional[Path] = None, allow_edits: bool = False, ledger: bool = True,
           add_dir: Optional[str] = None) -> Dict:
    """One non-interactive call. Always returns a record; never raises for agent failures."""
    if mc.cli_of(account) != "claude":
        raise mc.SkillError(f"{account} is not a Claude account")
    m, e = resolve_model(difficulty, model, effort)
    ts, t0 = mc.now_iso(), time.time()
    if mc.simulated_limit(account):
        rec = mc.result_record(account, "claude", m, e, False, "", "rate_limit",
                               "SIMULATED usage limit (MA_SIMULATE_LIMIT)", {}, 0.0, ts, 0.0, len(prompt))
    else:
        p = mc.run_process(build_argv(account, prompt, m, e, json_schema, add_dir or cwd, allow_edits), timeout_s, cwd)
        rec = _record_from_process(account, m, e, p, ts, time.time() - t0, len(prompt))
    if ledger:
        mc.write_ledger_for(rec, run_id, node, run_dir)
    return rec


def _record_from_process(account, m, e, p, ts, dur, plen) -> Dict:
    if p["timed_out"]:
        return mc.result_record(account, "claude", m, e, False, "", "timeout",
                                f"timeout after {int(dur)}s", {}, None, ts, dur, plen)
    d = parse_output(p["stdout"])
    u = d.get("usage") or {}
    usage = {"input_tokens": u.get("input_tokens", 0), "output_tokens": u.get("output_tokens", 0),
             "cached_input_tokens": u.get("cache_read_input_tokens", 0),
             "cache_write_tokens": u.get("cache_creation_input_tokens", 0), "reasoning_tokens": 0}
    text = d.get("result") or ""
    real_model = ",".join((d.get("modelUsage") or {}).keys()) or m
    # exit 0 is not success: is_error and result must be checked
    ok = bool(d) and not d.get("is_error") and p["rc"] == 0
    err = "" if ok else (text or p["stderr"] or "no JSON output")
    status = "ok" if ok else mc.classify_error(err)
    extra = {"model_actual": real_model}
    if "structured_output" in d:
        extra["structured_output"] = d["structured_output"]
    return mc.result_record(account, "claude", m, e, ok, text if ok else "", status, mc.short(err, 300),
                            usage, d.get("total_cost_usd"), ts, dur, plen, extra)


def check(accounts: List[str], timeout_s: int = 60) -> List[Dict]:
    """Readiness by a real minimal call. ready / expired (logged in but call fails) / not_logged_in."""
    out = []
    for a in accounts:
        st = mc.run_process([a, "auth", "status"], 30)
        logged = '"loggedIn": true' in (st["stdout"] or "")  # raw output is never printed
        if not logged:
            out.append({"account": a, "state": "not_logged_in", "detail": "auth status: not logged in"})
            continue
        r = invoke(a, CHECK_PROMPT, difficulty=1, timeout_s=timeout_s, node="check")
        if r["ok"] and "OK" in r["result"]:
            out.append({"account": a, "state": "ready", "detail": f"{r['duration_s']}s"})
        elif r["status"] == "auth":
            out.append({"account": a, "state": "expired", "detail": "logged in but call failed: " + mc.short(r["error"], 80)})
        else:
            out.append({"account": a, "state": r["status"], "detail": mc.short(r["error"], 80)})
    return out


_USAGE_RE = re.compile(r"^(Current (?:session|week[^:]*)):\s*(\d+)% used(?:\s*·\s*resets (.+))?$", re.M)


def quota(account: str) -> Dict:
    """Read built-in /usage (no model call). Reports 'no data' rather than guessing."""
    if mc.simulated_limit(account):
        return {"account": account, "available": False, "note": "SIMULATED limit", "as_of": mc.now_iso()}
    p = mc.run_process([account, "-p", "/usage", "--output-format", "json",
                        "--no-session-persistence", "--strict-mcp-config"], 60)
    d = parse_output(p["stdout"])
    text = d.get("result") or ""
    windows = [{"window": w, "used_percent": int(pct), "resets": (rs or "").strip()}
               for w, pct, rs in _USAGE_RE.findall(text)]
    if not windows:
        return {"account": account, "available": False, "note": "no quota data from /usage", "as_of": mc.now_iso()}
    sess = next((w["used_percent"] for w in windows if w["window"] == "Current session"), None)
    return {"account": account, "available": True, "session_used_percent": sess,
            "windows": windows, "as_of": mc.now_iso(), "source": "/usage"}


def _accounts_arg(v: Optional[str]) -> List[str]:
    accts = [a.strip() for a in v.split(",")] if v else mc.list_accounts(mc.CLAUDE_PREFIX)
    for a in accts:
        if mc.cli_of(a) != "claude":
            raise mc.SkillError(f"{a} is not a Claude account")
    return accts


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="clp.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--account", required=True)
    r.add_argument("--difficulty", type=int, default=1)
    r.add_argument("--model")
    r.add_argument("--effort")
    r.add_argument("--json-schema")
    r.add_argument("--cwd")
    r.add_argument("--allow-edits", action="store_true", help="permission-mode acceptEdits inside --cwd")
    r.add_argument("--timeout", type=int, default=mc.DEFAULT_TIMEOUT_S)
    r.add_argument("--json", action="store_true")
    r.add_argument("prompt")
    for name in ("check", "quota"):
        s = sub.add_parser(name)
        s.add_argument("--accounts")
        s.add_argument("--json", action="store_true")
    sub.add_parser("accounts")
    a = ap.parse_args(argv)
    try:
        mc.guard_not_child()
        return _dispatch(a)
    except mc.SkillError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2


def _dispatch(a) -> int:
    if a.cmd == "accounts":
        print("\n".join(mc.list_accounts(mc.CLAUDE_PREFIX)))
        return 0
    if a.cmd == "run":
        rec = invoke(a.account, a.prompt, a.difficulty, a.model, a.effort, a.json_schema, a.cwd,
                     a.timeout, allow_edits=a.allow_edits)
        if a.json:
            print(json.dumps(rec, ensure_ascii=False, indent=1))
        else:
            print(rec["result"] if rec["ok"] else f"FAILED [{rec['status']}]: {rec['error']}")
            u = rec["usage"]
            print(f"\n-- {rec['account']} {rec['model']}/{rec['effort']} {rec['duration_s']}s "
                  f"in={u.get('input_tokens', 0)} out={u.get('output_tokens', 0)} cost_usd={rec['cost_usd']}",
                  file=sys.stderr)
        return 0 if rec["ok"] else 1
    accts = _accounts_arg(a.accounts)
    if a.cmd == "check":
        res = check(accts)
        rows = [[x["account"], x["state"], x["detail"]] for x in res]
        print(json.dumps(res, indent=1) if a.json else mc.fmt_table(["account", "state", "detail"], rows))
        return 0
    res = [quota(x) for x in accts]
    if a.json:
        print(json.dumps(res, indent=1, ensure_ascii=False))
    else:
        rows = [[q["account"], "; ".join(f"{w['window']}: {w['used_percent']}% (resets {w['resets']})" for w in q["windows"])
                 if q["available"] else q["note"], q["as_of"]] for q in res]
        print(mc.fmt_table(["account", "quota", "as_of"], rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
