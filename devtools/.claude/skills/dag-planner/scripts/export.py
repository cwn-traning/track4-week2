"""export.py — locate the installed base skills and convert plan.json into an agent-team graph.json.

Base skills are used, never copied: graph validation calls agent-team `graph.expand()` (the same
function `team.py run` uses), which makes no model call. Lookup order (spec):
  env DAGPLAN_BASE_SKILLS -> sibling folders of this skill -> ./base_skills of the current directory
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

import blocks as bk

sys.dont_write_bytecode = True
REQUIRED = {"agent-team": "scripts/team.py", "clp": "scripts/macore.py", "cop": "scripts/cop.py"}
EXPORT_SCHEMA = "dag-planner/graph-export@1"
SIDE = {"clp": "clp", "cop": "cop"}


def candidates() -> List[Path]:
    env = os.environ.get("DAGPLAN_BASE_SKILLS")
    here = Path(__file__).resolve().parents[2]
    return ([Path(env)] if env else []) + [here, Path.cwd() / "base_skills"]


def find_base_skills() -> Optional[Path]:
    for root in candidates():
        if all((root / k / v).is_file() for k, v in REQUIRED.items()):
            return root.resolve()
    return None


def load_modules(root: Path):
    """Import agent-team graph.py + clp macore.py from the installed base skills (read-only)."""
    for p in (root / "clp" / "scripts", root / "agent-team" / "scripts"):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))
    import macore  # noqa: E402
    import graph  # noqa: E402
    return graph, macore


def difficulty_label(d: int, root: Optional[Path], skill: str = "review") -> str:
    """Model/effort from the base skill DIFFICULTY table; 'd<N>' if base skills are absent."""
    if root is None:
        return f"d{d}"
    _, mc = load_modules(root)
    m, e, ce = mc.DIFFICULTY[d]
    if skill == "yolo":
        return f"Claude {m}/{e}"
    if skill in ("cyolo", "image"):
        return f"Codex effort {ce}"
    return f"Claude {m}/{e} · Codex {ce}"


def _safe(text: str) -> str:
    """Block text is data: break '{{' so it cannot become an agent-team placeholder."""
    return str(text).replace("{{", "{ {").replace("}}", "} }")


REPLY_SKILLS = ("debate", "best_of")   # agent-team runs these read-only; result = out/<id>.md, not a file in app/


def _source(d: str, by: Dict[str, Dict], app_dir: str) -> str:
    """Where a dependency's result lives: its app/ file, or agent-team's out/<id>.md for reply-only blocks."""
    if by[d]["skill"] in REPLY_SKILLS:
        return f"{{{{file:{d}}}}}  (agent-team result of {d}; it decides what goes into {by[d]['output']})"
    return f"{app_dir}/{by[d]['output']}  (from {d})"


def node_prompt(doc: Dict, b: Dict, app_dir: str, deps: List[str], by: Dict[str, Dict]) -> str:
    """User text is passed through _safe(); only the template inserts real {{file:id}} placeholders."""
    reads = "\n".join(f"- {_source(d, by, app_dir)}" for d in deps) or "- (none)"
    head = (f"Project goal: {_safe(doc.get('goal', ''))}\n"
            f"Block {b['id']}: {_safe(b['title'])}\n"
            f"Done when: {_safe(b['done'])}\n"
            f"Read these results from earlier blocks first:\n{reads}\n")
    if b["skill"] in REPLY_SKILLS:
        return head + (f"Do not create files. Reply with the full content intended for {_safe(b['output'])} "
                       "(it is stored by agent-team and handed to later blocks).")
    own = ("You are the integration block: you may edit any file in the app folder." if b.get("exclusive")
           else "Do not modify files written by other blocks; write only your own output file.")
    return head + (f"Write your result to: {app_dir}/{_safe(b['output'])}\n{own}\n"
                   "Reply in one or two lines: which file(s) you wrote.")


def build_node(doc: Dict, b: Dict, plan_b: Dict, app_dir: str, by: Dict[str, Dict]) -> Dict:
    deps = sorted(b.get("depends_on", []))
    node = {"id": b["id"], "difficulty": b["difficulty"], "depends_on": deps, "cwd": app_dir, "write": True,
            "prompt": node_prompt(doc, b, app_dir, deps, by)}
    roles = plan_b.get("roles") or []
    sk = b["skill"]
    if sk == "yolo":
        node.update(account="clp", kind="code")
    elif sk == "cyolo":
        node.update(account="cop", kind="code")
    elif sk == "image":
        node.update(account="cop", kind="image", image_out=f"{app_dir}/{b['output']}")
        node.pop("write")
    elif sk == "review":
        w = SIDE[roles[0]["kind"]] if roles else "clp"
        node.update(type="review", account=w, kind="code", max_rounds=3,
                    reviewer={"account": "cop" if w == "clp" else "clp", "prompt": _safe(b["done"])})
    else:
        node.update(type=sk, accounts=[p["account"] for p in roles if p["role"] == "answer"],
                    judge=next(p["account"] for p in roles if p["role"] == "judge"))
        if sk == "best_of":
            node["criteria"] = _safe(b["done"])
        node.pop("write")
    return node


def build_graph(doc: Dict, plan: Dict, app_dir: str) -> Dict:
    """plan.json (canonical) -> graph.json. Debate/best_of need planned accounts (distinct by plan)."""
    if plan.get("status") != "OK":
        raise bk.PlanError(f"plan status is {plan.get('status')} — fix unassigned blocks before export")
    by = {b["id"]: b for b in doc["blocks"]}
    eff = plan["effective_deps"]
    nodes = []
    for bid in bk.topo_order(doc["blocks"], eff):
        n = build_node(doc, by[bid], plan["blocks"][bid], app_dir, by)
        n["depends_on"] = eff[bid]          # exclusivity edges included (agent-team has no 'exclusive')
        nodes.append(n)
    if not plan["accounts_used"]:
        raise bk.PlanError("plan uses no account — nothing to export")
    return {"goal": _safe(doc.get("goal", "")), "nodes": nodes,
            "dagplan": {"schema": EXPORT_SCHEMA, "plan": plan["name"], "plan_sha256": plan["blocks_sha256"],
                        "workers": plan["accounts_used"], "limits": plan["limits"]}}


def validate_with_agent_team(graph_doc: Dict, root: Path) -> int:
    """Run agent-team graph.expand() (no model call). Returns expanded node count or raises PlanError."""
    gr, mc = load_modules(root)
    try:
        return len(gr.expand(graph_doc))
    except mc.SkillError as e:
        raise bk.PlanError(f"agent-team rejected graph.json: {e}")
