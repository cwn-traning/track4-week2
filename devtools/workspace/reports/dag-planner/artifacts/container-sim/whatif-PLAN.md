# PLAN — whatif

Goal: เว็บร้านอาหารแมว Meow Shop: หน้าแรก รายการสินค้า ตะกร้า และภาพแบนเนอร์

Status: **OK** · planned at 2026-11-13T09:00:00+07:00 (fixed clock)
· quota: --accounts (assumed quota, no account touched) — ASSUMED values, not real quota
· limits: max agents 8, per account 3

## Metrics (planned, simulated minutes)

- Makespan: 66.7 min · critical path (B01 → B04 → B07 → B08): 63.1 min
- Peak concurrent agents: 8 · utilisation: clp2 113%, cop1 69%, cop2 68%
- Schedule is a greedy AT-QUEST list schedule — feasible and validated, not proven optimal.

## Accounts (hard constraints before scoring)

| account | eligible | reason | headroom % | slots | hours to expiry | U | expiry |
|---|---|---|---|---|---|---|---|
| clp1 | True | - | 8.0 | 1 | 168.0 | 0.125 | 2026-11-20T09:00:00+07:00 |
| clp2 | True | - | 100.0 | 3 | 168.0 | 0.125 | 2026-11-20T09:00:00+07:00 |
| cop1 | True | - | 100.0 | 3 | 168.0 | 0.125 | 2026-11-20T09:00:00+07:00 |
| cop2 | True | - | 100.0 | 3 | 168.0 | 0.125 | 2026-11-20T09:00:00+07:00 |

## Blocks

| block | title | skill | model/effort | accounts | start | end | AT-QUEST reason |
|---|---|---|---|---|---|---|---|
| B01 | โครงโปรเจกต์ | cyolo | Codex effort medium | worker=cop1 | 0.0 | 7.5 | cop1: AT-QUEST 30.3 (urgency=0.125 fit=0.002 session=0.984 speed=0.7 load=0.0) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd cop2 30.3 |
| B02 | เลือกโครงข้อมูลสินค้า | debate | Claude opus/high · Codex high | answer=clp2, answer=cop2, judge=cop1 | 7.5 | 17.3 | clp2: AT-QUEST 26.9 (urgency=0.125 fit=0.002 session=0.906 speed=0.773 load=0.333) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd clp1 17.6 / cop2: AT-QUEST 27.9 (urgency=0.125 fit=0.002 session=0.984 speed=0.541 load=0.0) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd cop1 27.7 / cop1: AT-QUEST 27.8 (urgency=0.125 fit=0.001 session=0.98 speed=0.541 load=0.0) · need 0.18M tok ≈ 5h 0.47% / week 0.06% · 2nd clp1 17.7 |
| B03 | ข้อมูลสินค้า | cyolo | Codex effort medium | worker=cop1 | 17.3 | 36.1 | cop1: AT-QUEST 26.1 (urgency=0.125 fit=0.005 session=0.925 speed=0.477 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd cop2 26.1 |
| B04 | หน้าเว็บหลัก | yolo | Claude opus/high | worker=clp2 | 7.5 | 32.5 | clp2: AT-QUEST 32.7 (urgency=0.125 fit=0.01 session=0.922 speed=0.909 load=0.0) · need 3.00M tok ≈ 5h 7.8% / week 0.98% |
| B05 | ภาพแบนเนอร์ | image | Codex effort low | worker=cop2 | 7.5 | 15.0 | cop2: AT-QUEST 19.6 (urgency=0.125 fit=0.002 session=0.969 speed=0.223 load=0.333) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd cop1 19.5 |
| B06 | สโลแกนร้าน | best_of | Claude sonnet/medium · Codex medium | answer=cop1, answer=clp2, judge=cop2 | 7.5 | 17.3 | cop1: AT-QUEST 19.5 (urgency=0.125 fit=0.002 session=0.964 speed=0.223 load=0.333) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd clp2 16.5 / clp2: AT-QUEST 16.5 (urgency=0.125 fit=0.002 session=0.891 speed=0.318 load=0.667) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd cop2 16.0 / cop2: AT-QUEST 16.2 (urgency=0.125 fit=0.001 session=0.964 speed=0.223 load=0.667) · need 0.18M tok ≈ 5h 0.47% / week 0.06% · 2nd clp1 10.9 |
| B07 | ตะกร้าสินค้า | review | Claude opus/high · Codex high | worker=clp2, reviewer=cop2 | 36.1 | 54.2 | clp2: AT-QUEST 24.7 (urgency=0.125 fit=0.005 session=0.852 speed=0.455 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd cop2 23.8 / cop2: AT-QUEST 24.1 (urgency=0.125 fit=0.001 session=0.952 speed=0.319 load=0.0) · need 0.45M tok ≈ 5h 1.17% / week 0.15% · 2nd cop1 23.5 |
| B08 | รวมระบบและทดสอบ | yolo | Claude opus/high | worker=clp2 | 54.2 | 66.7 | clp2: AT-QUEST 20.7 (urgency=0.125 fit=0.005 session=0.813 speed=0.227 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp1 9.1 |

Files: `dag.svg` · `gantt-plan.svg` (+ .png when Chromium exists) · `plan.json` (canonical data for DAG, Gantt and export)
