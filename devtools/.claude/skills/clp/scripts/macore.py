"""macore — shared core for the clp / cop / agent-team skills (stdlib only, Python 3.8+).

Owns: account naming, difficulty table, safe process execution, error
classification, ledger writing, child-agent recursion guard, simulators.
cop.py and team.py import this module from the sibling `clp` skill folder.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Dict, List, Optional

BASE = Path("/root/ai-accounts")
CLAUDE_PREFIX = "clp"
CODEX_PREFIX = "cop"
ACCOUNT_RE = re.compile(r"^(clp|cop)([1-9][0-9]?)$")
DEFAULT_TIMEOUT_S = 180
CHILD_ENV = "AGENT_TEAM_CHILD"          # set for every spawned agent process
SIMULATE_ENV = "MA_SIMULATE_LIMIT"      # comma list of accounts that fail like a usage limit

# difficulty -> (claude model, claude effort, codex effort)  (spec table)
DIFFICULTY = {
    1: ("haiku", "low", "low"),
    2: ("sonnet", "medium", "medium"),
    3: ("opus", "high", "high"),
    4: ("opus", "xhigh", "xhigh"),
    5: ("opus", "max", "max"),
    6: ("opus", "max", "ultra"),
}
CLAUDE_MODELS = ("opus", "sonnet", "haiku", "fable")
CLAUDE_EFFORTS = ("low", "medium", "high", "xhigh", "max")

LEDGER_FIELDS = (
    "ts_start", "ts_end", "run_id", "node", "account", "cli", "model", "effort",
    "duration_s", "input_tokens", "cached_input_tokens", "cache_write_tokens",
    "output_tokens", "reasoning_tokens", "cost_usd", "status", "error",
    "prompt_chars", "result_chars",
)


class SkillError(Exception):
    """User-facing error with a clean message (no traceback)."""


def now_iso() -> str:
    return _dt.datetime.now().astimezone().isoformat(timespec="seconds")


def team_home() -> Path:
    return Path(os.environ.get("AGENT_TEAM_HOME", "/workspace/.agent-team"))


def cli_of(account: str) -> str:
    m = ACCOUNT_RE.match(account or "")
    if not m:
        raise SkillError(f"invalid account '{account}' (expected clpN or copN)")
    return "claude" if m.group(1) == CLAUDE_PREFIX else "codex"


def list_accounts(prefix: str) -> List[str]:
    """Accounts that have both a wrapper on PATH and an account directory."""
    sub = ".Claude" if prefix == CLAUDE_PREFIX else ".Codex"
    out = []
    for n in range(1, 10):
        acct = f"{prefix}{n}"
        if shutil.which(acct) and (BASE / sub / acct).is_dir():
            out.append(acct)
    return out


def guard_not_child() -> None:
    """Max delegation depth = 1: a spawned agent may not spawn further agents."""
    if os.environ.get(CHILD_ENV):
        raise SkillError("recursion blocked: this process is a child agent "
                         f"({CHILD_ENV} is set); child agents may not invoke clp/cop/agent-team")


def child_env() -> Dict[str, str]:
    env = dict(os.environ)
    env[CHILD_ENV] = "1"
    return env


def simulated_limit(account: str) -> bool:
    names = [s.strip() for s in os.environ.get(SIMULATE_ENV, "").split(",") if s.strip()]
    return account in names


_AUTH_PAT = re.compile(r"failed to authenticate|oauth|not logged in|401|unauthori[sz]ed|invalid api key|login", re.I)
_LIMIT_PAT = re.compile(r"rate.?limit|usage limit|quota|429|too many requests|limit reached|out of (credits|usage)", re.I)


def classify_error(text: str) -> str:
    """Map an error message to: auth | rate_limit | error."""
    if _LIMIT_PAT.search(text or ""):
        return "rate_limit"
    if _AUTH_PAT.search(text or ""):
        return "auth"
    return "error"


def short(text: str, n: int = 200) -> str:
    t = " ".join((text or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


def run_process(argv: List[str], timeout_s: int, cwd: Optional[str] = None) -> Dict:
    """Run argv (no shell) with stdin closed. Returns rc/stdout/stderr/timed_out."""
    t0 = time.time()
    try:
        p = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                           timeout=timeout_s, cwd=cwd, env=child_env())
        return {"rc": p.returncode, "stdout": p.stdout, "stderr": p.stderr,
                "timed_out": False, "elapsed": time.time() - t0}
    except subprocess.TimeoutExpired as e:
        return {"rc": None, "stdout": e.stdout or "", "stderr": e.stderr or "",
                "timed_out": True, "elapsed": time.time() - t0}


def ledger_row(**kw) -> Dict:
    row = {k: None for k in LEDGER_FIELDS}
    row.update({k: v for k, v in kw.items() if k in LEDGER_FIELDS})
    return row


def append_ledger(row: Dict, run_dir: Optional[Path] = None) -> None:
    """Append one row to the global ledger (and the run ledger). Never stores prompts."""
    line = json.dumps(row, ensure_ascii=False) + "\n"
    targets = [team_home() / "ledger.jsonl"]
    if run_dir is not None:
        targets.append(Path(run_dir) / "ledger.jsonl")
    for t in targets:
        t.parent.mkdir(parents=True, exist_ok=True)
        with open(t, "a", encoding="utf-8") as f:
            f.write(line)


def result_record(account: str, cli: str, model: str, effort: str, ok: bool, text: str,
                  status: str, error: str, usage: Dict, cost: Optional[float],
                  ts_start: str, duration: float, prompt_chars: int, extra: Optional[Dict] = None) -> Dict:
    rec = {
        "ok": ok, "account": account, "cli": cli, "model": model, "effort": effort,
        "result": text, "status": status, "error": error, "usage": usage,
        "cost_usd": cost, "ts_start": ts_start, "ts_end": now_iso(),
        "duration_s": round(duration, 2), "prompt_chars": prompt_chars,
    }
    rec.update(extra or {})
    return rec


def write_ledger_for(rec: Dict, run_id: Optional[str], node: Optional[str], run_dir: Optional[Path]) -> None:
    u = rec.get("usage") or {}
    append_ledger(ledger_row(
        ts_start=rec["ts_start"], ts_end=rec["ts_end"], run_id=run_id, node=node,
        account=rec["account"], cli=rec["cli"], model=rec["model"], effort=rec["effort"],
        duration_s=rec["duration_s"], input_tokens=u.get("input_tokens", 0),
        cached_input_tokens=u.get("cached_input_tokens", 0),
        cache_write_tokens=u.get("cache_write_tokens", 0), output_tokens=u.get("output_tokens", 0),
        reasoning_tokens=u.get("reasoning_tokens", 0), cost_usd=rec.get("cost_usd"),
        status=rec["status"], error=short(rec.get("error") or "", 200) or None,
        prompt_chars=rec["prompt_chars"], result_chars=len(rec.get("result") or ""),
    ), run_dir)


def fmt_table(headers: List[str], rows: List[List]) -> str:
    cells = [[str(h) for h in headers]] + [["" if c is None else str(c) for c in r] for r in rows]
    w = [max(len(r[i]) for r in cells) for i in range(len(headers))]
    line = lambda r: "| " + " | ".join(r[i].ljust(w[i]) for i in range(len(r))) + " |"
    sep = "|" + "|".join("-" * (x + 2) for x in w) + "|"
    return "\n".join([line(cells[0]), sep] + [line(r) for r in cells[1:]])
