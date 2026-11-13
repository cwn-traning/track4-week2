"""Graph loading, validation, sugar expansion (debate / best_of) and placeholder rendering."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List

import macore as mc

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,63}$")
PH_RE = re.compile(r"\{\{(file:)?([A-Za-z0-9_\-]+)\}\}")
SIDES = ("clp", "cop", "any")
KINDS = ("text", "code", "review", "doc", "image")
INLINE_LIMIT = 1500   # longer results must be passed with {{file:node}}
NODE_KEYS = {"id", "type", "prompt", "account", "difficulty", "model", "effort", "kind", "depends_on",
             "expect", "approve", "cwd", "write", "image_out", "reviewer", "max_rounds", "accounts",
             "judge", "criteria", "timeout"}


def validate_account(spec: str) -> None:
    if spec in SIDES:
        return
    mc.cli_of(spec)   # raises SkillError on bad names


def expand(graph: Dict) -> List[Dict]:
    """Return a flat node list; debate/best_of become answer nodes + a judge node."""
    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list) or not graph["nodes"]:
        raise mc.SkillError("graph must be a JSON object with a non-empty 'nodes' list")
    defaults = graph.get("defaults") or {}
    out: List[Dict] = []
    for raw in graph["nodes"]:
        if not isinstance(raw, dict):
            raise mc.SkillError("each node must be an object")
        unknown = set(raw) - NODE_KEYS
        if unknown:
            raise mc.SkillError(f"node {raw.get('id')}: unknown keys {sorted(unknown)}")
        n = dict(defaults, **raw)
        t = n.get("type", "task")
        if t in ("debate", "best_of"):
            out.extend(_expand_judged(n, t))
        elif t in ("task", "review"):
            out.append(n)
        else:
            raise mc.SkillError(f"node {n.get('id')}: unknown type '{t}'")
    _validate(out)
    return out


def _expand_judged(n: Dict, t: str) -> List[Dict]:
    accts = n.get("accounts") or []
    if len(accts) < 2 or not n.get("judge"):
        raise mc.SkillError(f"node {n.get('id')}: {t} needs 'accounts' (>=2) and 'judge'")
    nid, base = n["id"], {k: v for k, v in n.items() if k in ("difficulty", "depends_on", "timeout", "cwd")}
    answers = []
    for i, a in enumerate(accts, 1):
        answers.append(dict(base, id=f"{nid}__{i}", prompt=n["prompt"], account=a, kind="text"))
    files = "\n".join(f"- candidate {i}: {{{{file:{x['id']}}}}}" for i, x in enumerate(answers, 1))
    if t == "debate":
        task = ("Several agents answered the same question independently. Read each candidate file, "
                "compare them, decide which answer is correct (or give the corrected answer), and explain why.")
    else:
        task = (f"Score each candidate 1-10 against these criteria: {n.get('criteria', 'correctness and quality')}. "
                "Pick the best one and explain the scores.")
    judge = dict(base, id=nid, account=n["judge"], depends_on=[x["id"] for x in answers], kind="review",
                 prompt=(f"{task}\nQuestion/task:\n{n['prompt']}\nCandidates:\n{files}\n"
                         "Reply format: first line 'WINNER: <candidate number>', then 'ANSWER: <final answer>', "
                         "then 'REASON: <reasoning>'."),
                 expect=n.get("expect", r"(?s).*WINNER:\s*\d+.*REASON:.*"))
    return answers + [judge]


def _validate(nodes: List[Dict]) -> None:
    ids = set()
    for n in nodes:
        nid = n.get("id")
        if not isinstance(nid, str) or not ID_RE.match(nid) or nid in ids:
            raise mc.SkillError(f"invalid or duplicate node id: {nid!r}")
        ids.add(nid)
        if not isinstance(n.get("prompt"), str) or not n["prompt"].strip():
            raise mc.SkillError(f"node {nid}: 'prompt' is required")
        validate_account(n.setdefault("account", "any"))
        if n.get("type") == "review":
            rv = n.get("reviewer") or {}
            validate_account(rv.get("account", "any"))
        d = n.setdefault("difficulty", 1)
        if not isinstance(d, int) or not 1 <= d <= 6:
            raise mc.SkillError(f"node {nid}: difficulty must be 1..6")
        if n.setdefault("kind", "text") not in KINDS:
            raise mc.SkillError(f"node {nid}: kind must be one of {KINDS}")
        for p in ("cwd", "image_out"):
            if n.get(p) and not str(n[p]).startswith("/"):
                raise mc.SkillError(f"node {nid}: {p} must be an absolute path")
        if n["kind"] == "image" and not n.get("image_out"):
            raise mc.SkillError(f"node {nid}: kind=image needs image_out (/abs/path.png)")
        if n["kind"] == "image" and n["account"].startswith("clp"):
            raise mc.SkillError(f"node {nid}: image generation is Codex-only (use cop/copN/any)")
        n.setdefault("depends_on", [])
    for n in nodes:
        refs = set(n["depends_on"]) | {m.group(2) for m in PH_RE.finditer(n["prompt"])}
        missing = refs - ids
        if missing:
            raise mc.SkillError(f"node {n['id']}: unknown dependency {sorted(missing)}")
        n["depends_on"] = sorted(set(n["depends_on"]) | {m.group(2) for m in PH_RE.finditer(n["prompt"])})
    _check_acyclic(nodes)


def _check_acyclic(nodes: List[Dict]) -> None:
    deps = {n["id"]: set(n["depends_on"]) for n in nodes}
    done: set = set()
    while deps:
        ready = [k for k, v in deps.items() if v <= done]
        if not ready:
            raise mc.SkillError(f"dependency cycle among: {sorted(deps)}")
        for k in ready:
            done.add(k)
            deps.pop(k)


def render(prompt: str, out_dir: Path) -> str:
    """{{node}} -> short result inline; {{file:node}} -> absolute path of out/<node>.md."""
    def sub(m):
        path = out_dir / f"{m.group(2)}.md"
        if m.group(1):
            return str(path)
        text = path.read_text(encoding="utf-8").strip()
        if len(text) > INLINE_LIMIT:
            raise mc.SkillError(f"result of '{m.group(2)}' is {len(text)} chars; use {{{{file:{m.group(2)}}}}}")
        return text
    return PH_RE.sub(sub, prompt)
