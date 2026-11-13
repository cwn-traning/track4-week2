# agent-team — policies and details

## Safety (enforced by the scripts)

| Rule | How |
|---|---|
| Max delegation depth = 1 | every agent is spawned by `team.py`/`clp.py`/`cop.py` with `AGENT_TEAM_CHILD=1`; all three scripts refuse to run when it is set. Claude workers also get `--disallowedTools Agent Task`. |
| Leader does not spawn agents | the leader returns a JSON plan; `leader.py` validates every node (ids, accounts, deps, cycles) before the script runs it |
| Agent output is data | outputs are stored in `out/`, checked with `expect`, never executed; placeholders only insert text or a path |
| No account switching to evade provider limits | `rate_limit` / `auth` errors mark the account `limit_hit`; dependent and queued work on it becomes `blocked` with the reason. No failover. |
| User-pinned accounts never move | a node with `account: clpN` is blocked (and reported) instead of being moved |
| Only allowed accounts are touched | `--workers` limits readiness checks, quota reads and dispatch; with no `--workers` and every node pinned, only pinned accounts are touched |
| No automatic retry of token-spending calls | failed nodes stay failed; rerun explicitly with `run --resume` |
| Budgets | `--max-invocations` (20), `--timeout` (180 s), `--max-parallel` (8), `--per-account` (3), `--worker-token-budget`, `--lead-token-budget` |
| Secrets | ledger stores counts only (no prompt text); scripts never read `.credentials.json`, `.claude.json` or `auth.json`; login state is parsed, never printed |

## Spec items adapted for the security constraints

- Spec "failover / reactive switch on quota, rate limit or expired login" → **stop and report** (BLOCKED by policy).
- Spec "proactive switch at session quota ≥ 80 %" → only shown as `near limit` in `status`; not used to move work.
- Proactive moves are driven only by the **user-set token budgets** (`--worker-token-budget`, `--lead-token-budget`).
- Reactive leader switch happens on crash / timeout / invalid plan (`--simulate-crash`), not on usage limits.
- `MA_SIMULATE_LIMIT=clp1` makes calls on clp1 fail like a usage limit, to show the stop-and-report behaviour.

## Readiness

Before a run the needed accounts are checked by a real minimal call (`haiku/low` or Codex `low`, "Reply with exactly: OK").
Results are cached for 10 minutes in `<AGENT_TEAM_HOME>/ready_cache.json`. States: `ready`, `expired`, `not_logged_in`, `unknown`, `rate_limit`, `error`.

## Router (`account: "any"`)

`kind` image / code / review → Codex (`cop`) · text / doc → Claude (`clp`). If the chosen side has no ready account the other side is used (image stays Codex-only).
Within a side, work is balanced by planned load and tokens used in the run.

## Files of a run

| File | Purpose |
|---|---|
| `graph.json` | the graph as submitted |
| `state.json` | node status, planned account, events, leader + switch history |
| `board.md` | shared findings (author + time) |
| `msgs/<from>__<to>.md` | hand-off messages (node→node, worker↔reviewer) |
| `out/<node>.md` | each node's result (kept even when `expect` fails) |
| `ledger.jsonl` | one row per call of this run + `worker_switch` / `lead_switch` events |
| `handoff.md` | leader checkpoint for the next leader |
| `approvals/<node>` | human-gate approval file (`team.py approve`) |

## Ledger fields

`ts_start, ts_end, run_id, node, account, cli, model, effort, duration_s, input_tokens, cached_input_tokens,
cache_write_tokens, output_tokens, reasoning_tokens, cost_usd (Claude, list price), status, error, prompt_chars, result_chars`

## Environment

- `AGENT_TEAM_HOME` — default `/workspace/.agent-team`
- `MA_SIMULATE_LIMIT` — comma list of accounts that fail like a usage limit (no model call)
