# REPORT — meow

> **SIMULATION** — agent-team ran with `MA_SIMULATE_LIMIT` on every worker: each started node returns a simulated usage limit, dependants are blocked. Actual minutes are harness wall time, not model work; nothing here shows that real execution succeeds.
> Real executor invocations caught by shims: 0

Run `20261113-162356-423` (simulation) · dir `/tmp/dagplan-hc2/meow/sim/20261113-162356-324800/agent-team-home/20261113-162356-423` · state from `state.json`, tokens from `ledger.jsonl`

- Planned makespan: 65.9 min (simulated plan clock)
- Actual span: 0.05 min (harness wall time)
- Calibration: {'written': False, 'why': 'simulation run — calibration not updated'}

| block | skill | planned accounts | actual accounts | plan min | actual min | tokens | status | reason |
|---|---|---|---|---|---|---|---|---|
| B01 | cyolo | cop1 | cop1 | 7.5 | 0.05 | 0 | failed | rate_limit: SIMULATED usage limit (MA_SIMULATE_LIMIT) |
| B02 | debate | clp2+cop1+clp1 | - | 9.0 | - | 0 | blocked | a dependency failed |
| B03 | cyolo | cop1 | - | 18.8 | - | 0 | blocked | a dependency failed |
| B04 | yolo | clp1 | - | 25.0 | - | 0 | blocked | a dependency failed |
| B05 | image | cop1 | - | 7.5 | - | 0 | blocked | a dependency failed |
| B06 | best_of | clp2+clp1+cop1 | - | 7.2 | - | 0 | blocked | a dependency failed |
| B07 | review | clp2+cop1 | - | 18.1 | - | 0 | blocked | a dependency failed |
| B08 | yolo | clp2 | - | 12.5 | - | 0 | blocked | a dependency failed |

Files: `gantt-actual.svg` · `compare.svg` (+ .png when Chromium exists)
