#!/usr/bin/env python3
"""cop — Codex CLI multi-account adapter (cop1..copN). Stdlib only, Python 3.8+.

Commands:
  run     --account copN [--difficulty D | --model M --effort E] [--cwd DIR] [--write] PROMPT
  image   --account copN --out /abs/path.png DESCRIPTION
  check   [--accounts cop1,cop2]     login status text + real minimal call
  quota   [--accounts ...]           rate_limits from latest non-ephemeral rollout
  models  [--account copN]           models + supported efforts from models_cache.json
"""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True  # keep shared skill dirs free of __pycache__
import argparse
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "clp" / "scripts"))
import macore as mc  # noqa: E402

CHECK_PROMPT = "Reply with exactly: OK"
EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"]
PNG_SIG = b"\x89PNG\r\n\x1a\n"


def codex_home(account: str) -> Path:
    return mc.BASE / ".Codex" / account


def load_models(account: str) -> List[Dict]:
    """Only slug / levels / default are read; other cache keys are ignored."""
    try:
        d = json.loads((codex_home(account) / "models_cache.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out = []
    for m in d.get("models", []) if isinstance(d, dict) else []:
        if isinstance(m, dict) and m.get("slug"):
            out.append({"slug": m["slug"],
                        "efforts": [x.get("effort") for x in m.get("supported_reasoning_levels", [])],
                        "default": m.get("default_reasoning_level")})
    return out


def resolve_model(account: str, difficulty: Optional[int], model: Optional[str], effort: Optional[str]):
    """Returns (model, effort, note). Unsupported effort is lowered to the highest supported one."""
    row = mc.DIFFICULTY.get(difficulty or 1)
    if row is None:
        raise mc.SkillError(f"difficulty must be 1..6, got {difficulty}")
    models = load_models(account)
    if not models:
        raise mc.SkillError(f"{account}: models_cache.json missing or unreadable; open the account once")
    want = effort or row[2]
    if want not in EFFORT_ORDER:
        raise mc.SkillError(f"invalid codex effort '{want}'")
    slug = model or models[0]["slug"]
    info = next((m for m in models if m["slug"] == slug), None)
    if info is None:
        raise mc.SkillError(f"model '{slug}' not in models_cache.json for {account}")
    if want in info["efforts"]:
        return slug, want, ""
    lower = [e for e in EFFORT_ORDER[: EFFORT_ORDER.index(want)] if e in info["efforts"]]
    if not lower:
        raise mc.SkillError(f"{slug} supports none of the efforts <= {want}")
    return slug, lower[-1], f"effort lowered {want}->{lower[-1]} ({slug} does not support {want})"


def parse_jsonl(out: str) -> Dict:
    usage, err, ok = {}, "", False
    for line in out.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        t = ev.get("type")
        if t == "turn.completed":
            u = ev.get("usage") or {}
            usage = {"input_tokens": u.get("input_tokens", 0), "cached_input_tokens": u.get("cached_input_tokens", 0),
                     "cache_write_tokens": u.get("cache_write_input_tokens", 0),
                     "output_tokens": u.get("output_tokens", 0), "reasoning_tokens": u.get("reasoning_output_tokens", 0)}
            ok = True
        elif t in ("turn.failed", "error"):
            e = ev.get("error") or {}
            err = (e.get("message") if isinstance(e, dict) else str(e)) or ev.get("message") or "turn failed"
            ok = False
    return {"usage": usage, "error": err, "ok": ok}


def build_argv(account, prompt, slug, effort, out_file, cwd, write) -> List[str]:
    argv = [account, "exec", "--skip-git-repo-check", "--ephemeral", "-m", slug,
            "-c", f"model_reasoning_effort={effort}", "--json", "-o", out_file]
    if cwd:
        argv += ["-C", cwd]
    if write:
        argv += ["-s", "workspace-write"]   # sandbox stays on; never the bypass flag
    return argv + [prompt]


def invoke(account: str, prompt: str, difficulty: Optional[int] = 1, model: Optional[str] = None,
           effort: Optional[str] = None, cwd: Optional[str] = None, write: bool = False,
           timeout_s: int = mc.DEFAULT_TIMEOUT_S, run_id: Optional[str] = None, node: Optional[str] = None,
           run_dir: Optional[Path] = None, ledger: bool = True, **_ignored) -> Dict:
    if mc.cli_of(account) != "codex":
        raise mc.SkillError(f"{account} is not a Codex account")
    slug, eff, note = resolve_model(account, difficulty, model, effort)
    ts, t0 = mc.now_iso(), time.time()
    if mc.simulated_limit(account):
        rec = mc.result_record(account, "codex", slug, eff, False, "", "rate_limit",
                               "SIMULATED usage limit (MA_SIMULATE_LIMIT)", {}, None, ts, 0.0, len(prompt))
    else:
        fd, out_file = tempfile.mkstemp(prefix="cop-", suffix=".txt")
        os.close(fd)
        try:
            p = mc.run_process(build_argv(account, prompt, slug, eff, out_file, cwd, write), timeout_s, cwd)
            answer = Path(out_file).read_text(encoding="utf-8", errors="replace").strip()
        finally:
            os.unlink(out_file)
        rec = _record(account, slug, eff, p, answer, ts, time.time() - t0, len(prompt))
    if note:
        rec["effort_note"] = note
    if ledger:
        mc.write_ledger_for(rec, run_id, node, run_dir)
    return rec


def _record(account, slug, eff, p, answer, ts, dur, plen) -> Dict:
    if p["timed_out"]:
        return mc.result_record(account, "codex", slug, eff, False, "", "timeout",
                                f"timeout after {int(dur)}s", {}, None, ts, dur, plen)
    j = parse_jsonl(p["stdout"])
    # exit code is not trusted: success needs turn.completed and a non-empty answer
    ok = j["ok"] and bool(answer)
    err = "" if ok else (j["error"] or mc.short(p["stderr"], 300) or "no answer")
    status = "ok" if ok else mc.classify_error(err)
    return mc.result_record(account, "codex", slug, eff, ok, answer if ok else "", status,
                            mc.short(err, 300), j["usage"], None, ts, dur, plen)


def image(account: str, out_path: str, description: str, timeout_s: int = mc.DEFAULT_TIMEOUT_S,
          run_id=None, node=None, run_dir=None) -> Dict:
    out = Path(out_path)
    if not out.is_absolute() or out.suffix.lower() != ".png":
        raise mc.SkillError("--out must be an absolute path ending in .png")
    out.parent.mkdir(parents=True, exist_ok=True)
    prompt = (f"Create an image (image generation): {description}. "
              f"Save it as a PNG file at {out}. Reply with only the path when done.")
    rec = invoke(account, prompt, difficulty=1, effort="low", cwd=str(out.parent), write=True,
                 timeout_s=timeout_s, run_id=run_id, node=node, run_dir=run_dir)
    is_png = out.is_file() and out.read_bytes()[:8] == PNG_SIG
    rec["image_path"], rec["is_png"] = str(out), is_png
    if rec["ok"] and not is_png:
        rec.update(ok=False, status="error", error="agent replied but file is missing or not a PNG")
    return rec


def login_state(account: str) -> str:
    p = mc.run_process([account, "login", "status"], 30)
    text = (p["stdout"] or "") + (p["stderr"] or "")   # parsed, never printed
    if "Logged in using" in text:
        return "logged_in"
    if "Not logged in" in text:
        return "not_logged_in"
    return "unknown"


def check(accounts: List[str], timeout_s: int = 90) -> List[Dict]:
    out = []
    for a in accounts:
        st = login_state(a)
        if st != "logged_in":
            out.append({"account": a, "state": st, "detail": "login status: " + st})
            continue
        r = invoke(a, CHECK_PROMPT, difficulty=1, timeout_s=timeout_s, node="check")
        if r["ok"] and "OK" in r["result"]:
            out.append({"account": a, "state": "ready", "detail": f"{r['duration_s']}s"})
        elif r["status"] == "auth":
            out.append({"account": a, "state": "expired", "detail": "logged in but call failed: " + mc.short(r["error"], 80)})
        else:
            out.append({"account": a, "state": r["status"], "detail": mc.short(r["error"], 80)})
    return out


def quota(account: str) -> Dict:
    """Latest rate_limits from non-ephemeral rollouts; ephemeral runs do not update it."""
    if mc.simulated_limit(account):
        return {"account": account, "available": False, "note": "SIMULATED limit", "as_of": mc.now_iso()}
    files = sorted((codex_home(account) / "sessions").glob("*/*/*/*.jsonl"), key=lambda f: f.stat().st_mtime)
    for f in reversed(files[-20:]):
        rl, ts = _last_rate_limits(f)
        if rl:
            win = []
            for k in ("primary", "secondary"):
                w = rl.get(k) or {}
                if w:
                    win.append({"window": f"{k} ({w.get('window_minutes')} min)", "used_percent": w.get("used_percent"),
                                "resets": str(w.get("resets_at"))})
            sess = (rl.get("primary") or {}).get("used_percent")
            return {"account": account, "available": True, "session_used_percent": sess, "windows": win,
                    "as_of": ts, "source": "rollout token_count"}
    return {"account": account, "available": False,
            "note": "no quota data (no non-ephemeral rollout with rate_limits)", "as_of": mc.now_iso()}


def _last_rate_limits(path: Path):
    rl, ts = None, None
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if '"token_count"' not in line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            r = (ev.get("payload") or {}).get("rate_limits")
            if r:
                rl, ts = r, ev.get("timestamp")
    except OSError:
        pass
    return rl, ts


def _accounts_arg(v: Optional[str]) -> List[str]:
    accts = [a.strip() for a in v.split(",")] if v else mc.list_accounts(mc.CODEX_PREFIX)
    for a in accts:
        if mc.cli_of(a) != "codex":
            raise mc.SkillError(f"{a} is not a Codex account")
    return accts


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="cop.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--account", required=True)
    r.add_argument("--difficulty", type=int, default=1)
    r.add_argument("--model")
    r.add_argument("--effort")
    r.add_argument("--cwd")
    r.add_argument("--write", action="store_true", help="sandbox workspace-write inside --cwd")
    r.add_argument("--timeout", type=int, default=mc.DEFAULT_TIMEOUT_S)
    r.add_argument("--json", action="store_true")
    r.add_argument("prompt")
    i = sub.add_parser("image")
    i.add_argument("--account", required=True)
    i.add_argument("--out", required=True)
    i.add_argument("--json", action="store_true")
    i.add_argument("description")
    for name in ("check", "quota"):
        s = sub.add_parser(name)
        s.add_argument("--accounts")
        s.add_argument("--json", action="store_true")
    m = sub.add_parser("models")
    m.add_argument("--account", default="cop1")
    a = ap.parse_args(argv)
    try:
        mc.guard_not_child()
        return _dispatch(a)
    except mc.SkillError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2


def _print_rec(rec: Dict, as_json: bool) -> int:
    if as_json:
        print(json.dumps(rec, ensure_ascii=False, indent=1))
    else:
        print(rec["result"] if rec["ok"] else f"FAILED [{rec['status']}]: {rec['error']}")
        u = rec["usage"]
        print(f"\n-- {rec['account']} {rec['model']}/{rec['effort']} {rec['duration_s']}s in={u.get('input_tokens', 0)} "
              f"out={u.get('output_tokens', 0)} reasoning={u.get('reasoning_tokens', 0)} {rec.get('effort_note', '')}",
              file=sys.stderr)
    return 0 if rec["ok"] else 1


def _dispatch(a) -> int:
    if a.cmd == "run":
        return _print_rec(invoke(a.account, a.prompt, a.difficulty, a.model, a.effort, a.cwd, a.write, a.timeout), a.json)
    if a.cmd == "image":
        rec = image(a.account, a.out, a.description)
        if not a.json:
            print(f"is_png={rec['is_png']} path={rec['image_path']}")
        return _print_rec(rec, a.json)
    if a.cmd == "models":
        rows = [[m["slug"], ",".join(m["efforts"]), m["default"]] for m in load_models(a.account)]
        print(mc.fmt_table(["model", "efforts", "default"], rows))
        return 0
    accts = _accounts_arg(a.accounts)
    if a.cmd == "check":
        res = check(accts)
        print(json.dumps(res, indent=1) if a.json else
              mc.fmt_table(["account", "state", "detail"], [[x["account"], x["state"], x["detail"]] for x in res]))
        return 0
    res = [quota(x) for x in accts]
    if a.json:
        print(json.dumps(res, indent=1))
    else:
        rows = [[q["account"], "; ".join(f"{w['window']}: {w['used_percent']}%" for w in q["windows"])
                 if q["available"] else q["note"], q["as_of"]] for q in res]
        print(mc.fmt_table(["account", "quota", "as_of"], rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
