"""blocks.py — load + validate blocks.json, effective dependencies, rank and critical path.

Pure functions, stdlib only. No base-skill code is copied here; the id rule mirrors
agent-team graph.ID_RE (shorter, so debate/best_of expansion ids `<id>__N` still fit).
"""
from __future__ import annotations

import json
import re
from pathlib import Path, PurePosixPath
from typing import Dict, List, Tuple

SIZE_MTOK = {"S": 0.6, "M": 1.5, "L": 3.0}          # spec + tools/orch.py size_mtok
SKILLS = ("yolo", "cyolo", "image", "review", "debate", "best_of")
MULTI = ("review", "debate", "best_of")
BLOCK_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,59}$")
PLAN_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,63}$")
RECOMMENDED_BLOCKS = (6, 14)
BEST_OF_N = (2, 4)


class PlanError(Exception):
    """User-facing planning error (clean message, exit code 1)."""


def check_plan_name(name: str) -> str:
    if not isinstance(name, str) or not PLAN_NAME_RE.fullmatch(name):
        raise PlanError(f"invalid plan name {name!r} (allowed: A-Z a-z 0-9 _ -, max 64)")
    return name


def load_doc(text: str) -> Dict:
    try:
        doc = json.loads(text)
    except ValueError as e:
        raise PlanError(f"blocks.json is not valid JSON: {e}")
    if not isinstance(doc, dict):
        raise PlanError("blocks.json must be a JSON object")
    return doc


def load_file(path: Path) -> Dict:
    try:
        return load_doc(Path(path).read_text(encoding="utf-8"))
    except OSError as e:
        raise PlanError(f"cannot read {path}: {e}")


# ---------------------------------------------------------------- validation
def _field_errors(b: Dict) -> List[str]:
    bid, errs = b.get("id"), []
    if not isinstance(b.get("title"), str) or not b["title"].strip():
        errs.append(f"{bid}: 'title' is required")
    if b.get("size") not in SIZE_MTOK:
        errs.append(f"{bid}: size must be S, M or L (got {b.get('size')!r})")
    if b.get("skill") not in SKILLS:
        errs.append(f"{bid}: unknown skill {b.get('skill')!r} (allowed: {', '.join(SKILLS)})")
    d = b.get("difficulty")
    if not isinstance(d, int) or isinstance(d, bool) or not 1 <= d <= 6:
        errs.append(f"{bid}: difficulty must be an integer 1..6")
    errs += _output_errors(b)
    if not isinstance(b.get("done"), str) or not b["done"].strip():
        errs.append(f"{bid}: 'done' (checkable acceptance criterion) is required")
    if not isinstance(b.get("exclusive", False), bool):
        errs.append(f"{bid}: 'exclusive' must be true/false")
    if not isinstance(b.get("depends_on", []), list):
        errs.append(f"{bid}: 'depends_on' must be a list")
    if b.get("skill") == "best_of":
        n = b.get("n", BEST_OF_N[0])
        if not isinstance(n, int) or not BEST_OF_N[0] <= n <= BEST_OF_N[1]:
            errs.append(f"{bid}: best_of 'n' must be {BEST_OF_N[0]}..{BEST_OF_N[1]}")
    return errs


def _output_errors(b: Dict) -> List[str]:
    out, bid = b.get("output"), b.get("id")
    if not isinstance(out, str) or not out.strip():
        return [f"{bid}: 'output' (file written under app/) is required"]
    p = PurePosixPath(out.replace("\\", "/"))
    if p.is_absolute() or ".." in p.parts or re.match(r"^[A-Za-z]:", out):
        return [f"{bid}: output must be a relative path inside app/ (got {out!r})"]
    if b.get("skill") == "image" and p.suffix.lower() != ".png":
        return [f"{bid}: image output must end with .png"]
    return []


def validate(doc: Dict) -> Tuple[List[str], List[str]]:
    """Return (errors, warnings). Errors block dag/plan/export."""
    errs: List[str] = []
    blocks = doc.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return ["blocks.json needs a non-empty 'blocks' list"], []
    ids: List[str] = []
    for b in blocks:
        if not isinstance(b, dict):
            errs.append("each block must be an object")
            continue
        bid = b.get("id")
        if not isinstance(bid, str) or not BLOCK_ID_RE.fullmatch(bid) or "__" in bid:
            errs.append(f"invalid block id {bid!r} (A-Z a-z 0-9 _ -, max 60, no '__')")
        elif bid in ids:
            errs.append(f"duplicate block id {bid!r}")
        ids.append(bid)
        errs += _field_errors(b)
    if errs:
        return errs, []
    errs += _dep_errors(blocks)
    if not errs:
        errs += [f"dependency cycle among: {', '.join(c)}" for c in [find_cycle(blocks)] if c]
    return errs, _warnings(doc, blocks)


def _dep_errors(blocks: List[Dict]) -> List[str]:
    ids, errs = {b["id"] for b in blocks}, []
    for b in blocks:
        for d in b.get("depends_on", []):
            if d == b["id"]:
                errs.append(f"{b['id']}: depends on itself")
            elif d not in ids:
                errs.append(f"{b['id']}: unknown dependency {d!r}")
    return errs


def find_cycle(blocks: List[Dict]) -> List[str]:
    """Kahn's algorithm; returns the ids left over (in a cycle or behind one), sorted."""
    deps = {b["id"]: set(b.get("depends_on", [])) for b in blocks}
    done: set = set()
    while True:
        ready = [k for k, v in deps.items() if v <= done]
        if not ready:
            return sorted(deps)
        for k in ready:
            done.add(k)
            deps.pop(k)
        if not deps:
            return []


def _warnings(doc: Dict, blocks: List[Dict]) -> List[str]:
    w = []
    lo, hi = RECOMMENDED_BLOCKS
    if not lo <= len(blocks) <= hi:
        w.append(f"{len(blocks)} blocks (decomposition rule recommends {lo}-{hi})")
    if not str(doc.get("goal", "")).strip():
        w.append("'goal' is empty — node prompts will have no project goal")
    for a, b in file_conflicts(blocks):
        w.append(f"{a} and {b} write the same output and are not ordered — scheduler serialises them")
    return w


# ---------------------------------------------------------------- graph analysis
def successors(blocks: List[Dict], deps: Dict[str, List[str]]) -> Dict[str, List[str]]:
    succ = {b["id"]: [] for b in blocks}
    for b in blocks:
        for d in deps[b["id"]]:
            succ[d].append(b["id"])
    return {k: sorted(v) for k, v in succ.items()}


def declared_deps(blocks: List[Dict]) -> Dict[str, List[str]]:
    return {b["id"]: sorted(set(b.get("depends_on", []))) for b in blocks}


def descendants(bid: str, succ: Dict[str, List[str]]) -> set:
    seen, stack = set(), [bid]
    while stack:
        for k in succ[stack.pop()]:
            if k not in seen:
                seen.add(k)
                stack.append(k)
    return seen


def effective_deps(blocks: List[Dict]) -> Dict[str, List[str]]:
    """Declared deps + exclusivity edges: an exclusive block waits for every block that is not its
    descendant, so it runs alone. Adding an edge from a non-descendant never creates a cycle."""
    deps = {k: set(v) for k, v in declared_deps(blocks).items()}
    for b in sorted((x for x in blocks if x.get("exclusive")), key=lambda x: x["id"]):
        succ = successors(blocks, {k: sorted(v) for k, v in deps.items()})
        below = descendants(b["id"], succ)
        deps[b["id"]] |= {x["id"] for x in blocks if x["id"] != b["id"] and x["id"] not in below}
    return {k: sorted(v) for k, v in deps.items()}


def ancestors(bid: str, deps: Dict[str, List[str]]) -> set:
    seen, stack = set(), [bid]
    while stack:
        for k in deps[stack.pop()]:
            if k not in seen:
                seen.add(k)
                stack.append(k)
    return seen


def file_conflicts(blocks: List[Dict]) -> List[Tuple[str, str]]:
    """Pairs of blocks with the same output path that are not ordered by declared deps."""
    deps = declared_deps(blocks)
    by_out: Dict[str, List[str]] = {}
    for b in blocks:
        by_out.setdefault(str(PurePosixPath(b["output"].replace("\\", "/"))), []).append(b["id"])
    pairs = []
    for ids in by_out.values():
        for i, a in enumerate(sorted(ids)):
            for b in sorted(ids)[i + 1:]:
                if a not in ancestors(b, deps) and b not in ancestors(a, deps):
                    pairs.append((a, b))
    return pairs


def ranks(blocks: List[Dict], deps: Dict[str, List[str]]) -> Dict[str, float]:
    """rank(j) = size_mtok(j) + max rank(blocks waiting on j)  (AT-QUEST step ①, raw M tok)."""
    succ, cost = successors(blocks, deps), {b["id"]: SIZE_MTOK[b["size"]] for b in blocks}
    memo: Dict[str, float] = {}
    for bid in topo_order(blocks, deps)[::-1]:
        memo[bid] = round(cost[bid] + max([memo[k] for k in succ[bid]] + [0.0]), 3)
    return memo


def topo_order(blocks: List[Dict], deps: Dict[str, List[str]]) -> List[str]:
    order, done, left = [], set(), {b["id"] for b in blocks}
    while left:
        ready = sorted(k for k in left if set(deps[k]) <= done)
        if not ready:
            raise PlanError(f"dependency cycle among: {', '.join(sorted(left))}")
        order += ready
        done |= set(ready)
        left -= set(ready)
    return order


def critical_path(blocks: List[Dict], deps: Dict[str, List[str]], rank: Dict[str, float]) -> List[str]:
    """Start at the root with the highest rank and follow the highest-rank successor (ties: id)."""
    succ = successors(blocks, deps)
    roots = [b["id"] for b in blocks if not deps[b["id"]]]
    pick = lambda ids: sorted(ids, key=lambda i: (-rank[i], i))[0]
    cur = pick(roots)
    path = [cur]
    while succ[cur]:
        cur = pick(succ[cur])
        path.append(cur)
    return path


def levels(blocks: List[Dict], deps: Dict[str, List[str]]) -> Dict[str, int]:
    lv: Dict[str, int] = {}
    for bid in topo_order(blocks, deps):
        lv[bid] = 1 + max([lv[d] for d in deps[bid]] + [-1])
    return lv
