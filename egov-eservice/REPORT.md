# REPORT — egov-eservice

Run `20261113-234600-399` (real) · dir `/workspace/.agent-team/20261113-234600-399` · state from `state.json`, tokens from `ledger.jsonl`

- Planned makespan: 159.9 min (simulated plan clock)
- Actual span: 35.1 min (wall time)
- Calibration: {'written': True, 'k': {'yolo': 0.194, 'review': 0.197, 'cyolo': 0.257}}

| block | skill | planned accounts | actual accounts | plan min | actual min | tokens | status | reason |
|---|---|---|---|---|---|---|---|---|
| B01 | yolo | clp1 | clp1 | 25.0 | 5.07 | 2113444 | ok |  |
| B02 | yolo | clp1 | clp2 | 12.5 | 1.0 | 449935 | ok |  |
| B03 | review | clp2+cop1 | clp1 | 18.1 | 2.02 | 1752614 | ok |  |
| B04 | yolo | clp1 | clp2 | 12.5 | 2.52 | 1038602 | ok |  |
| B05 | review | clp1+cop1 | clp1 | 18.1 | 5.56 | 2762542 | ok |  |
| B06 | yolo | clp1 | clp2 | 25.0 | 8.17 | 5423134 | ok |  |
| B07 | cyolo | cop1 | cop1 | 18.8 | 4.65 | 1531421 | ok |  |
| B08 | review | clp1+cop1 | clp1 | 18.1 | 3.6 | 3360563 | ok |  |
| B09 | review | clp2+cop1 | clp2 | 18.1 | 3.11 | 3519023 | ok |  |
| B10 | cyolo | cop1 | cop1 | 7.5 | 1.88 | 534095 | ok |  |
| B11 | cyolo | cop1 | cop1 | 7.5 | 2.15 | 532637 | ok |  |
| B12 | yolo | clp2 | clp2 | 25.0 | 4.47 | 607290 | ok |  |
| B13 | yolo | clp2 | clp1 | 25.0 | 6.9 | 1922023 | ok |  |
| B14 | yolo | clp1 | clp1 | 25.0 | 0.98 | 570113 | ok |  |

Files: `gantt-actual.svg` · `compare.svg` (+ .png when Chromium exists)
