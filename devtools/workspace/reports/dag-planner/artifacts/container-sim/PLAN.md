# PLAN — meow

Goal: เว็บร้านอาหารแมว Meow Shop: หน้าแรก รายการสินค้า ตะกร้า และภาพแบนเนอร์

Status: **OK** · planned at 2026-11-13T09:00:00+07:00 (fixed clock)
· quota: --accounts (assumed quota, no account touched) — ASSUMED values, not real quota
· limits: max agents 8, per account 3

## Metrics (planned, simulated minutes)

- Makespan: 65.9 min · critical path (B01 → B04 → B07 → B08): 63.1 min
- Peak concurrent agents: 8 · utilisation: clp1 62%, clp2 71%, cop1 103%
- Schedule is a greedy AT-QUEST list schedule — feasible and validated, not proven optimal.

## Accounts (hard constraints before scoring)

| account | eligible | reason | headroom % | slots | hours to expiry | U | expiry |
|---|---|---|---|---|---|---|---|
| clp1 | True | - | 100.0 | 3 | 168.0 | 0.125 | 2026-11-20T09:00:00+07:00 |
| clp2 | True | - | 100.0 | 3 | 168.0 | 0.125 | 2026-11-20T09:00:00+07:00 |
| cop1 | True | - | 100.0 | 3 | 168.0 | 0.125 | 2026-11-20T09:00:00+07:00 |
| cop2 | True | - | 40.0 | 3 | 168.0 | 0.125 | 2026-11-20T09:00:00+07:00 |

## Blocks

| block | title | skill | model/effort | accounts | start | end | AT-QUEST reason |
|---|---|---|---|---|---|---|---|
| B01 | โครงโปรเจกต์ | cyolo | Codex effort medium | worker=cop1 | 0.0 | 7.5 | cop1: AT-QUEST 30.3 (urgency=0.125 fit=0.002 session=0.984 speed=0.7 load=0.0) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd cop2 21.3 |
| B02 | เลือกโครงข้อมูลสินค้า | debate | Claude opus/high · Codex high | answer=clp2, answer=cop1, judge=clp1 | 7.5 | 16.5 | clp2: AT-QUEST 31.4 (urgency=0.125 fit=0.002 session=0.984 speed=0.773 load=0.0) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd clp1 26.9 / cop1: AT-QUEST 27.7 (urgency=0.125 fit=0.002 session=0.969 speed=0.541 load=0.0) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd cop2 18.9 / clp1: AT-QUEST 27.0 (urgency=0.125 fit=0.001 session=0.917 speed=0.773 load=0.333) · need 0.18M tok ≈ 5h 0.47% / week 0.06% · 2nd cop2 19.1 |
| B03 | ข้อมูลสินค้า | cyolo | Codex effort medium | worker=cop1 | 16.5 | 35.3 | cop1: AT-QUEST 25.9 (urgency=0.125 fit=0.005 session=0.909 speed=0.477 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd cop2 17.7 |
| B04 | หน้าเว็บหลัก | yolo | Claude opus/high | worker=clp1 | 7.5 | 32.5 | clp1: AT-QUEST 32.7 (urgency=0.125 fit=0.01 session=0.922 speed=0.909 load=0.0) · need 3.00M tok ≈ 5h 7.8% / week 0.98% · 2nd clp2 32.7 |
| B05 | ภาพแบนเนอร์ | image | Codex effort low | worker=cop1 | 7.5 | 15.0 | cop1: AT-QUEST 19.4 (urgency=0.125 fit=0.002 session=0.953 speed=0.223 load=0.333) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd cop2 14.1 |
| B06 | สโลแกนร้าน | best_of | Claude sonnet/medium · Codex medium | answer=clp2, answer=clp1, judge=cop1 | 7.5 | 14.7 | clp2: AT-QUEST 21.0 (urgency=0.125 fit=0.002 session=0.969 speed=0.318 load=0.333) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd clp1 16.7 / clp1: AT-QUEST 16.7 (urgency=0.125 fit=0.002 session=0.902 speed=0.318 load=0.667) · need 0.60M tok ≈ 5h 1.56% / week 0.2% · 2nd cop1 15.8 / cop1: AT-QUEST 15.9 (urgency=0.125 fit=0.001 session=0.949 speed=0.223 load=0.667) · need 0.18M tok ≈ 5h 0.47% / week 0.06% · 2nd cop2 14.3 |
| B07 | ตะกร้าสินค้า | review | Claude opus/high · Codex high | worker=clp2, reviewer=cop1 | 35.3 | 53.4 | clp2: AT-QUEST 25.9 (urgency=0.125 fit=0.005 session=0.93 speed=0.455 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp1 24.9 / cop1: AT-QUEST 23.3 (urgency=0.125 fit=0.001 session=0.898 speed=0.319 load=0.0) · need 0.45M tok ≈ 5h 1.17% / week 0.15% · 2nd cop2 15.6 |
| B08 | รวมระบบและทดสอบ | yolo | Claude opus/high | worker=clp2 | 53.4 | 65.9 | clp2: AT-QUEST 21.9 (urgency=0.125 fit=0.005 session=0.891 speed=0.227 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp1 21.4 |

Files: `dag.svg` · `gantt-plan.svg` (+ .png when Chromium exists) · `plan.json` (canonical data for DAG, Gantt and export)
