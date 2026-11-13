"""render.py — SVG for DAG, Gantt (plan / actual) and plan-vs-actual; optional PNG via headless Chromium."""
from __future__ import annotations

import html
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

import blocks as bk

FONT = "'Noto Sans Thai','Leelawadee UI','Tahoma',sans-serif"
CRIT = "#dc5a1e"
SKILL_STYLE = {   # colour, icon, label — all six differ
    "yolo": ("#2b7bd6", "✍", "yolo · Claude"),
    "cyolo": ("#2e9e5b", "⌨", "cyolo · Codex"),
    "image": ("#d35490", "🖼", "image · Codex"),
    "review": ("#8e44ad", "🔍", "review · 2 CLIs"),
    "debate": ("#d4a017", "⚖", "debate · 3 accts"),
    "best_of": ("#16a3a3", "🏆", "best_of · N+1"),
}
BOX_W, BOX_H, GAP_X, GAP_Y, PAD = 230, 106, 70, 22, 30


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def short(s: str, n: int) -> str:
    s = str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def _svg(w: float, h: float, body: List[str], title: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.0f}" height="{h:.0f}" '
            f'viewBox="0 0 {w:.0f} {h:.0f}" font-family="{FONT}">'
            f'<rect width="100%" height="100%" fill="#ffffff"/>'
            f'<text x="{PAD}" y="26" font-size="17" font-weight="bold" fill="#222">{esc(title)}</text>'
            + "".join(body) + "</svg>\n")


def legend(x: float, y: float, crit_label: str) -> List[str]:
    out = []
    for i, (sk, (col, icon, label)) in enumerate(SKILL_STYLE.items()):
        cx = x + i * 150
        out.append(f'<rect x="{cx}" y="{y}" width="14" height="14" rx="3" fill="{col}"/>'
                   f'<text x="{cx + 20}" y="{y + 12}" font-size="12" fill="#333">{esc(icon)} {esc(label)}</text>')
    cx = x + len(SKILL_STYLE) * 150
    out.append(f'<line x1="{cx}" y1="{y + 7}" x2="{cx + 26}" y2="{y + 7}" stroke="{CRIT}" stroke-width="4"/>'
               f'<text x="{cx + 32}" y="{y + 12}" font-size="12" fill="#333">{esc(crit_label)}</text>')
    return out


# ---------------------------------------------------------------- DAG
def render_dag(doc: Dict, rank: Dict[str, float], crit: List[str], labels: Dict[str, str],
               accounts: Optional[Dict[str, str]] = None, title: str = "") -> str:
    blocks = doc["blocks"]
    deps = bk.declared_deps(blocks)
    lv = bk.levels(blocks, deps)
    cols: Dict[int, List[str]] = {}
    for bid in sorted(lv, key=lambda i: (lv[i], -rank[i], i)):
        cols.setdefault(lv[bid], []).append(bid)
    pos = {bid: (PAD + c * (BOX_W + GAP_X), 60 + r * (BOX_H + GAP_Y))
           for c, ids in cols.items() for r, bid in enumerate(ids)}
    w = PAD * 2 + len(cols) * (BOX_W + GAP_X)
    h = 60 + max(len(v) for v in cols.values()) * (BOX_H + GAP_Y) + 50
    crit_edges = set(zip(crit, crit[1:]))
    body = [_edge(pos[d], pos[b["id"]], (d, b["id"]) in crit_edges) for b in blocks for d in deps[b["id"]]]
    by = {b["id"]: b for b in blocks}
    body += [_box(by[bid], pos[bid], rank[bid], bid in crit, labels[bid], (accounts or {}).get(bid)) for bid in pos]
    body += legend(PAD, h - 30, "critical path")
    return _svg(max(w, 1100), h, body, title or f"DAG — {doc.get('name', '')}")


def _edge(a, b, is_crit: bool) -> str:
    x1, y1, x2, y2 = a[0] + BOX_W, a[1] + BOX_H / 2, b[0], b[1] + BOX_H / 2
    mx = (x1 + x2) / 2
    col, sw = (CRIT, 3.5) if is_crit else ("#9aa5b1", 1.6)
    return (f'<path d="M{x1},{y1} C{mx},{y1} {mx},{y2} {x2 - 6},{y2}" fill="none" stroke="{col}" stroke-width="{sw}"/>'
            f'<polygon points="{x2},{y2} {x2 - 8},{y2 - 4} {x2 - 8},{y2 + 4}" fill="{col}"/>')


def _box(b: Dict, p, rank: float, is_crit: bool, model: str, acct: Optional[str]) -> str:
    x, y = p
    col, icon, label = SKILL_STYLE[b["skill"]]
    stroke = f'stroke="{CRIT}" stroke-width="3"' if is_crit else 'stroke="#c3cad3" stroke-width="1.2"'
    ex = " · exclusive" if b.get("exclusive") else ""
    out = [f'<rect x="{x}" y="{y}" width="{BOX_W}" height="{BOX_H}" rx="8" fill="#f8fafc" {stroke}/>',
           f'<text x="{x + 10}" y="{y + 19}" font-size="13" font-weight="bold" fill="#111">{esc(b["id"])}</text>',
           f'<text x="{x + 52}" y="{y + 19}" font-size="12" fill="#222">{esc(short(b["title"], 22))}</text>',
           f'<text x="{x + 10}" y="{y + 38}" font-size="11" fill="#555">size {b["size"]} · rank {rank:g}{ex}</text>',
           f'<rect x="{x + 8}" y="{y + 47}" width="{BOX_W - 16}" height="20" rx="10" fill="{col}"/>',
           f'<text x="{x + 16}" y="{y + 61}" font-size="11.5" fill="#fff">{esc(icon)} {esc(label)} · d{b["difficulty"]}</text>',
           f'<text x="{x + 10}" y="{y + 83}" font-size="10.5" fill="#444">{esc(short(model, 34))}</text>']
    if acct:
        out.append(f'<text x="{x + 10}" y="{y + 99}" font-size="10.5" '
                   f'font-weight="bold" fill="#0b4f8a">accounts: {esc(short(acct, 28))}</text>')
    return "".join(out)


# ---------------------------------------------------------------- Gantt
def _tick(span: float) -> float:
    for t in (5, 10, 15, 30, 60, 120, 240, 480):
        if span / t <= 12:
            return t
    return 960


def render_gantt(bars: List[Dict], skill_of: Dict[str, str], crit: List[str], title: str, unit: str = "min") -> str:
    """bars: {block, role, account, start, end, status?}. Rows = accounts; multi-account blocks are linked
    with the same label and a dashed connector."""
    bars = pack_lanes(bars)
    rows = sorted({b["lane"] for b in bars}) or [("(none)", 0)]
    span = max([b["end"] for b in bars] + [1.0])
    lx, top, rh = 110, 60, 34
    width = 1100
    sc = (width - lx - PAD) / span
    h = top + len(rows) * rh + 80
    body = [f'<text x="{PAD}" y="{top + i * rh + 22}" font-size="13" fill="#222">{esc(a[0]) if a[1] == 0 else ""}</text>'
            f'<line x1="{lx}" y1="{top + (i + 1) * rh}" x2="{width - PAD}" y2="{top + (i + 1) * rh}" stroke="#eee"/>'
            for i, a in enumerate(rows)]
    tk = _tick(span)
    t = 0.0
    while t <= span + 1e-9:
        x = lx + t * sc
        body.append(f'<line x1="{x:.1f}" y1="{top}" x2="{x:.1f}" y2="{top + len(rows) * rh}" stroke="#ddd"/>'
                    f'<text x="{x:.1f}" y="{top + len(rows) * rh + 16}" font-size="11" text-anchor="middle" fill="#555">{t:g}</text>')
        t += tk
    body.append(f'<text x="{width - PAD}" y="{top + len(rows) * rh + 32}" font-size="11" text-anchor="end" fill="#555">{unit}</text>')
    body += _bars(bars, rows, skill_of, set(crit), lx, top, rh, sc)
    body += legend(PAD, h - 26, "critical path (border)")
    return _svg(width, h, body, title)


def pack_lanes(bars: List[Dict]) -> List[Dict]:
    """Each account gets as many sub-rows (lanes) as it has overlapping bars (parallel slots)."""
    out, ends = [], {}
    for b in sorted(bars, key=lambda x: (x["account"], x["start"], x["block"])):
        lanes = ends.setdefault(b["account"], [])
        i = next((k for k, e in enumerate(lanes) if e <= b["start"] + 1e-9), len(lanes))
        if i == len(lanes):
            lanes.append(0.0)
        lanes[i] = b["end"]
        out.append(dict(b, lane=(b["account"], i)))
    return out


def _bars(bars, rows, skill_of, crit, lx, top, rh, sc) -> List[str]:
    out, by_block = [], {}
    for b in bars:
        r = rows.index(b["lane"])
        x, w = lx + b["start"] * sc, max((b["end"] - b["start"]) * sc, 4)
        y = top + r * rh + 5
        col = SKILL_STYLE.get(skill_of.get(b["block"], "yolo"))[0]
        bad = b.get("status") not in (None, "ok", "planned")
        stroke = f'stroke="{CRIT}" stroke-width="2.5"' if b["block"] in crit else 'stroke="#fff"'
        fill = f'fill="{col}"' + (' fill-opacity="0.35"' if bad else "")
        tag = f'{b["block"]}' + (f' {b["role"]}' if b.get("role") not in (None, "worker") else "")
        tag += f' [{b["status"]}]' if bad else ""
        out.append(f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="{rh - 10}" rx="4" {fill} {stroke}/>'
                   f'<text x="{x + 4:.1f}" y="{y + 16}" font-size="11" fill="{"#222" if bad else "#fff"}">{esc(tag)}</text>')
        by_block.setdefault(b["block"], []).append((x, y))
    for pts in by_block.values():
        if len(pts) > 1:
            x = min(p[0] for p in pts) + 2
            ys = sorted(p[1] for p in pts)
            out.append(f'<line x1="{x:.1f}" y1="{ys[0]}" x2="{x:.1f}" y2="{ys[-1] + rh - 10}" '
                       f'stroke="#333" stroke-dasharray="3,3" stroke-width="1.2"/>')
    return out


def render_compare(rows: List[Dict], skill_of: Dict[str, str], title: str) -> str:
    """rows: {block, plan_start, plan_end, act_start?, act_end?, status}."""
    span = max([r["plan_end"] for r in rows] + [r.get("act_end") or 0 for r in rows] + [1.0])
    lx, top, rh, width = 150, 60, 40, 1100
    sc = (width - lx - PAD) / span
    body = []
    for i, r in enumerate(rows):
        y = top + i * rh
        col = SKILL_STYLE[skill_of[r["block"]]][0]
        body.append(f'<text x="{PAD}" y="{y + 18}" font-size="12" fill="#222">{esc(r["block"])} ({esc(r["status"])})</text>'
                    f'<rect x="{lx + r["plan_start"] * sc:.1f}" y="{y + 4}" width="{max((r["plan_end"] - r["plan_start"]) * sc, 3):.1f}" '
                    f'height="12" rx="3" fill="{col}" fill-opacity="0.35"/>')
        if r.get("act_start") is not None:
            body.append(f'<rect x="{lx + r["act_start"] * sc:.1f}" y="{y + 19}" '
                        f'width="{max((r["act_end"] - r["act_start"]) * sc, 3):.1f}" height="12" rx="3" fill="{col}"/>')
        else:
            body.append(f'<text x="{lx + 4}" y="{y + 30}" font-size="10.5" fill="#a33">no actual run</text>')
    h = top + len(rows) * rh + 40
    body.append(f'<text x="{PAD}" y="{h - 14}" font-size="12" fill="#333">light = planned · solid = actual · minutes '
                f'(0 = plan start / first actual start)</text>')
    return _svg(width, h, body, title)


# ---------------------------------------------------------------- output
CHROME_CANDIDATES = ("chromium", "chromium-browser", "google-chrome", "chrome", "headless_shell", "msedge")
WIN_PATHS = (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
             r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")


def find_chromium() -> Optional[str]:
    env = os.environ.get("DAGPLAN_CHROMIUM")
    if env and Path(env).is_file():
        return env
    for c in CHROME_CANDIDATES:
        p = shutil.which(c)
        if p:
            return p
    return next((p for p in WIN_PATHS if Path(p).is_file()), None)


def write_svg(path: Path, svg: str, png: bool = True) -> List[str]:
    """Write SVG; also PNG when a headless Chromium exists. Returns written paths."""
    path.write_text(svg, encoding="utf-8")
    out = [str(path)]
    exe = find_chromium() if png else None
    if exe:
        pngp = path.with_suffix(".png")
        w, h = _size(svg)
        argv = [exe, "--headless", "--disable-gpu", "--hide-scrollbars", f"--window-size={w},{h}",
                f"--screenshot={pngp}", path.resolve().as_uri()]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            argv.insert(2, "--no-sandbox")
        try:
            subprocess.run(argv, capture_output=True, timeout=60, check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
        if pngp.is_file():
            out.append(str(pngp))
    return out


def _size(svg: str):
    import re
    m = re.search(r'width="(\d+)" height="(\d+)"', svg)
    return (int(m.group(1)), int(m.group(2))) if m else (1200, 800)
