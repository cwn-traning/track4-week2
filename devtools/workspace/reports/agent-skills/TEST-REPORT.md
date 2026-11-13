# TEST-REPORT — Agent Skills `clp` · `cop` · `agent-team`

Date: 2026-11-13 · Environment: container `devtools` · Report contains no credentials, tokens, emails, org names or raw auth output.

## 1. Executive Summary

| Item | Result |
|---|---|
| **Overall status** | **PARTIAL**. All implementable requirements PASS. 5 spec items are BLOCKED by the non-negotiable security constraints, and 2 are BLOCKED/SKIP because only 2 of 10 accounts are logged in. |
| Requirements coverage | 66 requirements traced. 58 PASS, 6 BLOCKED, 2 PASS-with-limitation. 0 FAIL. |
| Total tests | 78 |
| PASS / FAIL / SKIP / BLOCKED | **69 / 0 / 3 / 6** |
| Deployment | **DEPLOYED and VERIFIED**. 12 files are byte-identical in source, the Claude shared dir and the Codex shared dir. Rollback was not needed. |
| Defects found by testing | 10 skill defects, all fixed, redeployed and retested (section 8.4). 1 defect in my test harness, fixed. |

Why PARTIAL rather than Complete: the spec asks for quota-driven failover and account switching on rate limit, usage limit or expired login. That contradicts the constraints "ห้ามสลับบัญชีเพื่อหลบ Rate Limit / Usage Limit" and "หยุด execution ที่เกี่ยวข้องและรายงาน". Those items are BLOCKED. A compliant "stop and report" behaviour was built and tested in their place.

## 2. Environment

| Item | Value |
|---|---|
| Container | `devtools`, running before and after (no stop, restart, create or delete) |
| Claude Code | 2.1.323 (spec was written against 2.1.319) |
| Codex CLI | 0.168.0 (spec was written against 0.167.0) |
| Python | 3.12.3 (scripts are stdlib only and Python 3.8+ compatible) |
| Wrappers | `clp1`–`clp5` → `lib/run-claude.sh`, `cop1`–`cop5` → `lib/run-codex.sh`. Wrappers run `sync_skills` on every call. |
| Auth status (normalized) | clp1 = LOGGED_IN · clp2–5 = NOT_LOGGED_IN · cop1 = LOGGED_IN · cop2–5 = NOT_LOGGED_IN · UNKNOWN = none. Unchanged at the end. |
| Test accounts used | **clp1, cop1 only** |
| Models/effort actually used | Claude `haiku/low` (difficulty 1) and `sonnet/medium` (difficulty 2, leader and real-user agent) · Codex `gpt-6.1-sol` at `low`/`medium` |
| Execution budget | max concurrent 2 (tests) · max 20 agent calls per run (`--max-invocations` default) · timeout 180 s per call · no automatic retries |
| Flags verified with `--help` | claude: `-p --model --effort --output-format --no-session-persistence --strict-mcp-config --json-schema --permission-mode --disallowedTools --add-dir` · codex exec: `--skip-git-repo-check --ephemeral -m -c --json -o -C -s` |

## 3. Created and Modified Files

Source (Single Source of Truth): `./devtools/.claude/skills/`

| Path | Purpose |
|---|---|
| `clp/SKILL.md` | Claude multi-account skill: "ต้องการ → คำสั่ง" table, rules, "เรียกจาก host" |
| `clp/scripts/clp.py` | `run`, `check` (real call), `quota` (`/usage`), `accounts`. Judges success on `is_error`, not on exit 0. |
| `clp/scripts/macore.py` | Shared core: account validation, difficulty table, process runner (no shell), error classification, ledger, recursion guard, simulator |
| `cop/SKILL.md` | Codex multi-account skill |
| `cop/scripts/cop.py` | `run`, `image` (with PNG signature check), `check`, `quota` (rollout `rate_limits`), `models` (from `models_cache.json`, lowers unsupported effort) |
| `agent-team/SKILL.md` | Team skill (9.8 KB): table, sample graphs, leader demo, host usage |
| `agent-team/references/policies.md` | Safety rules, adapted spec items, router, run files, ledger fields |
| `agent-team/scripts/team.py` | CLI: `run` / `--resume` / `--patch`, `lead`, `status`, `stats`, `quota`, `check`, `approve` |
| `agent-team/scripts/graph.py` | Graph validation, debate/best_of expansion, `{{node}}` / `{{file:node}}` rendering, cycle check |
| `agent-team/scripts/engine.py` | Run directory, account pool, router, DAG scheduler, budgets, human gate, review loop, board, msgs |
| `agent-team/scripts/leader.py` | Leader supervisor: episodes, checkpoint/handoff, proactive and reactive switches, simulators, JSON-schema plan |
| `agent-team/scripts/report.py` | Summary, status, stats (by account, model and run) and quota tables |
| `devtools/workspace/reports/agent-skills/TEST-REPORT.md` | This report |

Runtime (managed, created by this work): `/root/ai-accounts/.Claude/shared/skills/{clp,cop,agent-team}/` and `/root/ai-accounts/.Codex/shared/skills/{clp,cop,agent-team}/`

Other artefacts:
- Container temp: `/tmp/agstage`, `/tmp/agdeploy`, `/tmp/agtest/` (test runs, backups of replaced managed files under `/tmp/agtest/backup/`).
- Host-command tests wrote to the spec-designated workspace: `./devtools/workspace/.agent-team/` (5 runs + ledger) and `./devtools/workspace/img/dot.png`. Nothing else in the project was modified.
- Test scripts (not in the project): scratchpad `test_offline.py`, `ux.py` and graph JSON files.

## 4. Requirement Traceability Matrix

Spec: `../Teaching_CWN2026/01_week02/04_MultiAccount_Skill/prompt_skill_spec.md`

| Req ID | Requirement (spec) | Implementation | Test ID | Status |
|---|---|---|---|---|
| R-01 | 3 skills = `SKILL.md` + `scripts/` (+`references/`), Python stdlib only | 3 folders | ST-1, ST-2 | PASS |
| R-02 | SKILL.md short; opens with "ต้องการ → คำสั่ง"; details in references | all SKILL.md files | ST-2, AB-a/b/c | PASS |
| R-03 | description in Thai + English with triggers | frontmatter | ST-2 | PASS |
| R-04 | Only 3 skill folders, no installer | No installer. The source dir also holds 7 pre-existing `guide-*` skills (user-chosen path, A3). | ST-1 | PASS (limitation) |
| R-05 | "เรียกจาก host" section with `docker exec` + `cat SKILL.md` | all SKILL.md files | IT-K | PASS |
| R-06 | Claude single call: `-p`, stdin closed, prompt before variadic flags | `clp.build_argv`, `run_process(stdin=DEVNULL)` | IT-3 | PASS |
| R-07 | exit 0 ≠ success: check `is_error` / `result` | `_record_from_process` | IT-3, UT | PASS |
| R-08 | Readiness by real call; ready / expired / not logged in | `clp.check`, `cop.check` | IT-2 | PASS ("expired" live state SKIP-1) |
| R-09 | JSON fields: result, is_error, usage, cost, modelUsage | parsed into record and ledger | IT-3 | PASS |
| R-10 | Model aliases and efforts; `--json-schema` → `structured_output` | `resolve_model`; leader plan schema | IT-H2 | PASS |
| R-11 | Same account runs several jobs at once with `--no-session-persistence` | always passed | IT-K (lead demo, clp1 ×2 concurrently) | PASS |
| R-12 | Quota via `/usage`; "no data" if missing | `clp.quota` | IT-A, IT-K | PASS |
| R-13 | Never read `.credentials.json` / `.claude.json`; no email or orgId | not referenced | S4, S5 | PASS |
| R-14 | Codex exec flags, `-o` answer file, JSONL usage, `turn.failed` | `cop.invoke`, `parse_jsonl` | IT-3 | PASS |
| R-15 | Codex quota from non-ephemeral rollout with timestamp | `cop.quota` | IT-A | PASS (no-data path; with-data path SKIP-2) |
| R-16 | Login state from `login status` text, not exit code | `cop.login_state` | IT-2 | PASS |
| R-17 | Models/efforts from `models_cache.json`; lower unsupported effort and record it | `cop.resolve_model` | UT (real cache) | PASS |
| R-18 | Image generation via Codex at `low`; check PNG signature | `cop.image` | IT-B5, IT-K, AB-c | PASS |
| R-19 | Never read `auth.json` | not referenced | S4 | PASS |
| R-20 | Difficulty → model/effort table shared by all three skills | `macore.DIFFICULTY` | IT-3, IT-B (d1, d2) | PASS (d3–6 live SKIP-3) |
| R-21 | Run dir: graph, board, msgs, out, ledger, state, handoff | `RunDir` | IT-A, IT-H | PASS |
| R-22 | relay | DAG + `{{node}}` | IT-A1 | PASS |
| R-23 | fan-out / fan-in | DAG | IT-B1 | PASS on 2 accounts; 3 distinct accounts BLOCKED-1 |
| R-24 | graph (DAG), ready nodes run in parallel | `Scheduler.run` | IT-A, IT-B | PASS |
| R-25 | review loop until `APPROVED` or `max_rounds` | `review_loop` | IT-C, UT | PASS |
| R-26 | board shared via `board.md` (author + time) | `absorb`, `board_add` | IT-A3 | PASS |
| R-27 | debate Claude vs Codex + judge | `graph._expand_judged` | IT-B2, AB-c | PASS |
| R-28 | best-of-N + judge with criteria | same | IT-B3 | PASS |
| R-29 | router picks side by task type when `any` | `route_side` | IT-B4 | PASS |
| R-30 | load distribution by quota + **failover** on quota or expired login | — | B-2 | **BLOCKED** (security). Stop-and-report built instead: IT-G PASS. |
| R-31 | human gate waits for approval file | `gate_open`, `team.py approve` | IT-D, UT | PASS |
| R-32 | before dispatch, rank accounts by quota | ranks by planned load and run tokens; quota shown only | IT-F | PASS (adapted; quota-ranking BLOCKED, see R-30) |
| R-33 | proactive worker switch: session ≥ 80 % **or** `--worker-token-budget` | budget part done | IT-F, UT | PASS (budget) / **BLOCKED** (quota ≥ 80 %, B-4) |
| R-34 | reactive worker switch on quota, rate limit or expired login | stop and block, no move | IT-G, UT | **BLOCKED** (B-3); safe behaviour PASS |
| R-35 | no silent switch; pinned accounts never moved; events in state, board and ledger | `pick_account`, `event` | IT-F, UT | PASS |
| R-36 | `team.py status` table with "หยุดรับงาน" state | `report.status_text` | IT-F | PASS |
| R-37 | leader state in files; supervisor is a script; workers independent of the leader | `leader.py` (leader only returns JSON, so depth stays 1) | IT-H, IT-I | PASS |
| R-38 | proactive leader switch: quota ≥ 80 % or lead token budget | budget part | IT-H, IT-I | PASS (budget) / **BLOCKED** (quota, B-5) |
| R-39 | reactive leader switch: crash, timeout or heartbeat **and quota / rate limit / expired login** | crash, failure and invalid plan → switch; limit → STOP | IT-H, IT-I, UT | PASS (crash) / **BLOCKED** (limit, B-5) |
| R-40 | successor: `--succession` or auto (ready, same CLI first) | `next_leader` | IT-H2, IT-H | PASS |
| R-41 | every switch logged (state, board, ledger `lead_switch`) | `Scheduler.event` | IT-H, IT-J | PASS |
| R-42 | simulators `MA_SIMULATE_LIMIT`, `--lead-token-budget` | `macore.simulated_limit` | IT-G, IT-H | PASS |
| R-43 | budgets checked during the run, not only at the end | after every leader call and every worker node | IT-H, IT-F | PASS |
| R-44 | one-command demo (`--demo` and `--demo --goal`); progress lines; final tables | `cmd_lead` | IT-H, IT-I, IT-K, AB-b | PASS |
| R-45 | `{{node}}` inline / `{{file:node}}` path; long text not inlined | `graph.render` (limit 1500) | IT-A2, UT | PASS |
| R-46 | require the reply format the next node needs, and check it | `expect` (`int`, `json`, regex search) | IT-A, IT-A5 | PASS |
| R-47 | failed node → dependents stop; no auto-retry of token-spending calls | `deps_state`, no retry | UT, IT-G | PASS |
| R-48 | no `eval`, never run outputs as shell | none in code | ST-3, S3 | PASS |
| R-49 | account = specific / side / any; readiness before start; no silent switch | `candidates`, `Pool.check_ready` | IT-A, IT-B | PASS |
| R-50 | `--workers` allow-list; all-pinned graph touches only pinned accounts | `allowed_accounts` | IT-A4 | PASS |
| R-51 | concurrency 3 per account and 8 total by default; per-task timeout | `--per-account`, `--max-parallel`, `--timeout` | ST, IT | PASS |
| R-52 | SKILL.md sample "parallel → review → fix and test"; common work needs no references | agent-team SKILL.md | AB-a | PASS |
| R-53 | `run` ends with summary table + quota; `--json` | `finish` | IT-A, IT-M | PASS |
| R-54 | `run --resume`: ok nodes not rerun; prompt/expect can be patched | `cmd_run` | IT-A5 | PASS |
| R-55 | bad-format result kept in `out/` with reason | `finish` writes before `expect` | IT-A | PASS |
| R-56 | per-node `cwd`, absolute paths in prompt | `cwd`/`write` → Codex `-C -s workspace-write`, Claude `--add-dir` + `acceptEdits` | IT-B5 | PASS (Claude `write` not run live) |
| R-57 | host examples work in PowerShell and Git Bash unchanged | `//root/...` paths, `cat file \| docker exec -i` | IT-K, IT-K2 | PASS |
| R-58 | graph from host via stdin, no heredoc | `run -` | IT-K, IT-K2 | PASS |
| R-59 | exit codes; `check`/`quota`/`status`/`stats` exit 0; empty state prints a message | `main`, `cmd_status` | IT-N, IT-2 | PASS |
| R-60 | agent-team SKILL.md about 10 KB or less | 9,767 bytes | ST-5 | PASS |
| R-61 | ledger row per call, all fields, no prompt or secret | `macore.write_ledger_for` | IT-3, UT, S5 | PASS |
| R-62 | stats by account, model and run; totals match the ledger | `report.stats_text` | IT-J | PASS |
| R-63 | install = copy only; no dependency outside the skill except siblings | `cop`/`team` import sibling `clp/scripts/macore.py` | IT-1 | PASS |
| R-64 | every account sees all 3 skills | wrappers' `sync_skills` | IT-1, R4 | PASS |
| R-65 | real-user test: fresh agent reads only SKILL.md; 3 scenarios; no skill-caused failures | — | AB-a/b/c | PASS (with clp1 instead of clp2: BLOCKED-6) |
| R-66 | devtools/workspace/reports/agent-skills/TEST-REPORT.md | this file | — | PASS |

## 5. Test Results

Columns: CLI, account, model and effort are shown where an agent was called. "—" means no model call.

### 5.1 Static validation

| Test | Req | Description | Expected | Actual | Status |
|---|---|---|---|---|---|
| ST-1 | R-01 | `py_compile` of all 8 scripts (staging and runtime) | no errors | OK | PASS |
| ST-2 | R-02, R-03 | YAML frontmatter `name` = folder name, `description` present | valid | 3/3 valid | PASS |
| ST-3 | R-48 | grep for `eval(`, `exec(`, `shell=True`, `os.system`, secret patterns, emails | none | none | PASS |
| ST-4 | — | `--help` of clp.py, cop.py, team.py | exit 0 | exit 0 | PASS |
| ST-5 | R-60 | agent-team SKILL.md size | ≤ ~10 KB | 9,767 B | PASS |
| ST-6 | — | permissions: entry scripts 755, modules and docs 644; no `__pycache__` in shared | as stated | as stated; 0 `__pycache__` | PASS |

### 5.2 Unit tests

`test_offline.py`: fake agents, zero model calls, run against the staging copy and the deployed runtime copy. **24/24 PASS.** The first run found 1 ERROR (defect D-1), which was fixed.

They cover:
- graph: debate expansion, best_of validation, cycle, unknown keys, bad account, image on Claude, placeholder dependencies, render, long-inline error
- `expect`: int, json, regex search vs anchored regex
- error classification and account-name injection
- simulated limit: no call, ledger row with all fields, no prompt text stored
- Codex effort lowering on the real `models_cache.json`
- recursion guard in all 3 scripts
- scheduler: relay, rate limit → no failover, pinned and unusable → blocked, worker budget move, max invocations, board lines, human gate, review loop (approved in round 2)
- leader: crash + proactive switches finish the goal; leader limit → STOP with no switch; invalid leader nodes rejected

### 5.3 Integration tests (real calls; clp1 = Claude `haiku/low` unless noted, cop1 = Codex `gpt-6.1-sol/low`)

| Test | Req | Description | Expected | Actual (sanitized evidence) | Exit | Duration | Status |
|---|---|---|---|---|---|---|---|
| IT-1 | R-63, R-64 | Open each of the 10 accounts once (`--version`); check skill links | each account sees 3 skills | 10/10 accounts show 3/3, symlinked to shared | 0 | ~5 s | PASS |
| IT-2 | R-08, R-16 | `clp.py check`, `cop.py check` | ready / not_logged_in | clp1 ready (3.2 s), cop1 ready (9.1 s), 8 accounts not_logged_in with no model call | 0 | 3.2 s / 9.6 s | PASS |
| IT-3 | R-06, R-09, R-14, R-61 | Single call each side: "17+25, number only" | `42`; full ledger row | clp1 `42` (in=2, out=3, cost_usd 0.0024) · cop1 `42` (in=18,200, out=5); ledger fields_ok = True for both | 0 / 0 | 3.3 s / 7.7 s | PASS |
| IT-A1 | R-22 | Cross-CLI relay `7*6` (clp1) → `+100` (cop1) → `*3` (clp1) | 42 → 142 → 426 | `[42, 142, 426]` equals independent calculation `[42, 142, 426]` | 0 | 57.6 s (run) | PASS |
| IT-A2 | R-45 | `{{file:f1}}` passes a 60-line, 4,130-char file | f2 = 60 | f2 answered `60` | 0 | 31 s + 5 s | PASS |
| IT-A3 | R-26 | b1 writes `BOARD: codeword=…`, b2 reads the board | same codeword | b1 `VQNZRK`, b2 `VQNZRK`; board.md has author + time | 0 | 12 s + 3.8 s | PASS |
| IT-A4 | R-50 | All nodes pinned, no `--workers` | only clp1/cop1 checked and called | run ledger accounts = `['clp1', 'cop1']` | 0 | — | PASS |
| IT-A5 | R-54, R-55 | s3 `expect_failed` (haiku replied "142 × 3 = 426") → `--resume`, then `--resume --patch` | only s3 reruns; output kept | resume: 1 new ledger row, still failed (output kept). patch + resume: 1 new row, s3 = `426` ok. Ok nodes were never rerun. | 1 → 0 | 3.2 s / 3.3 s | PASS |
| IT-B1 | R-23 | Fan-out of 3 nodes (`any`) + fan-in (`clp`, sonnet/medium) | merged list of 3 | numbered list of 3 points | 0 | 87.8 s (run) | PASS (2 accounts) |
| IT-B2 | R-27 | debate "Is 2^31−1 prime?", clp1 vs cop1, judge clp1 | verdict with reasoning | `WINNER: 2 / ANSWER: Yes / REASON: … candidate 1 contradicts itself…` | 0 | 3.9 + 10.2 + 5.6 s | PASS |
| IT-B3 | R-28 | best-of-2 slogan, judge cop1, criteria "exactly 5 words, catchy" | scored choice | `WINNER: 1 … Candidate 1: 9/10 … Candidate 2: 8/10` | 0 | 3.7 + 17.3 + 14.6 s | PASS |
| IT-B4 | R-29 | router: doc/text → Claude, code/image → Codex | correct side | fo1 doc→clp1, fo2 code→cop1, fo3 text→clp1, pic image→cop1 | 0 | — | PASS |
| IT-B5 | R-18, R-56 | image node → `/tmp/agtest/it/img/red.png` | real PNG | PNG signature True, 168 bytes | 0 | 57.8 s | PASS |
| IT-C | R-25 | review loop: clp1 sonnet/medium writes, cop1 reviews, `max_rounds` 3 | APPROVED within limit | APPROVED in round 1; msgs `clp1__cop1.md` and `cop1__clp1.md` written | 0 | 16.2 s | PASS |
| IT-D | R-31 | human gate | no call until approved | after 8 s: pending, 0 calls; after `team.py approve`: ok `GATE-PASSED` | 0 | 2.9 s | PASS |
| IT-F | R-33, R-35, R-36 | `--worker-token-budget clp1=1`, 4 `any` nodes | queued work moves; status shows not accepting work | `worker_switch: w3 clp1 → cop1`; w1 on clp1 finished normally; `status`: clp1 = "not accepting work"; 1 `worker_switch` row in ledger | 0 | ~28 s | PASS |
| IT-G | R-34, R-42 | `MA_SIMULATE_LIMIT=clp1` | stop and report, no failover | l1 and l2 on clp1 failed `rate_limit (SIMULATED)`, "STOP … no failover (policy)"; l3 on cop1 ok; no model call for clp1 | 1 | 8.4 s | PASS |
| IT-H | R-37–R-44 | `lead --demo` (built-in goal), first version | 3 event types + correct merge | Events happened and FINAL.md was correct, but found defect D-3 (exit 1, 2 wasted merges) | 1 | 117 s | Superseded by IT-K demo |
| IT-I | R-44 | `lead --demo --goal "<git cheat sheet, 3 workers, merge>"` | 3 events; one merged file | proactive ×2, reactive ×2 (crash + invalid JSON), worker move `sec_sync clp1→cop1`; FINAL.md = 3 sections, 9 commands | 0 | 65 s | PASS (found D-4, D-5) |
| IT-H2 | R-10, R-40 | `lead --leader clp1 --succession clp1` with JSON-schema plan | done in a few episodes, no failures | 2 episodes, 0 switches, merged list | 0 | ~21 s | PASS |
| IT-J | R-62 | `team.py stats` vs independent ledger sum | equal | stats: calls 60, tokens 2,086,359, cost 0.7585 = independent: 60, 2,086,359, 0.7585 | 0 | <1 s | PASS |
| IT-K | R-05, R-57, R-58 | Every "เรียกจาก host" line of the 3 SKILL.md files, verbatim from **Git Bash** on Windows (13 lines) | rc 0 | 13/13 rc = 0. Includes `cat graph.json \| docker exec -i … run -` and `image --out //workspace/img/dot.png` (signature `89 50 4e 47 0d 0a 1a 0a`). Final `lead --demo` re-run after fixes: all 3 events, 4/4 nodes ok. | 0 | 0–73 s | PASS |
| IT-K2 | R-57 | Same lines in **PowerShell 7** (`cat SKILL.md`, `cat graph.json \| docker exec -i … run -`) | rc 0 | h1 and h2 ok, rc 0 | 0 | ~15 s | PASS |
| IT-M | R-53 | `run --resume … --json` | pure JSON on stdout | First try failed (D-9: progress lines on stdout). After the fix: valid JSON with keys `exit, leader_history, nodes, quota, result, run_dir, run_id, worker_switches`. | 0 | <1 s | PASS |
| IT-N | R-59 | `status` / `stats` with no runs | message, no traceback, rc 0 | "no runs yet …" / "no ledger rows yet …", rc 0 | 0 | <1 s | PASS |

### 5.4 Agent behavior tests: real user (fresh `clp1`, `sonnet/medium`, `stream-json`; reads only agent-team SKILL.md)

The agent was allowed `Bash(python3:*)`, `Bash(cat:*)`, `Read` and `Write` only. Results were verified from `state.json`, `out/` and files, not from the agent's own claims.

| Test | Scenario (new tasks, not in the examples) | Round 1: commands / failed | Skill fix | Final round: commands / failed | Objective evidence | Status |
|---|---|---|---|---|---|---|
| AB-a | (ก) 2 parallel `slugify` implementations → review by another account → review-loop fix → table + quota | 5 / 2 (heredoc blocked; `echo $?` blocked) | D-6, D-7 | **3 / 0** (69.3 s → 55.1 s) | run `…142740`: impl_a, impl_b, review, fix all ok | PASS |
| AB-b | (ข) leader-switch and worker-move demo with own goal (IaaS/PaaS/SaaS glossary) | **2 / 0** | — | 2 / 0 (67.4 s) | events: lead proactive, worker_switch, lead reactive, lead proactive; FINAL.md 901 chars containing all 3 terms | PASS |
| AB-c | (ค) one graph: fan-out 2 + debate (Pluto, IAU 2006) + image | 4 / 1 (unneeded `mkdir` blocked) | D-8 | **4 / 0** (65.9 s → 84.9 s) | 6/6 nodes ok; judge `WINNER: 2 / ANSWER: No … dwarf planet`; `star.png` PNG signature True | PASS |

No agent opened `scripts/` or `references/`. No agent call timed out. A further scenario-(a) run is not counted: it completed (run `…142141`, all ok) but my harness crashed while parsing its output (harness defect H-1).

### 5.5 Security tests

| Test | Description | Expected | Actual | Status |
|---|---|---|---|---|
| S1 | Recursion guard live: `AGENT_TEAM_CHILD=1` for clp.py, cop.py and team.py | refuse | rc 2 ×3 "recursion blocked …" | PASS |
| S2 | Account injection `clp1;id`, `$(id)` | rejected | rc 2 "invalid account" | PASS |
| S3 | Prompt with `$(id) \`whoami\` ; rm -rf /x` (1 call) | passed literally, no shell | agent echoed the literal text | PASS |
| S4 | Code contains no bypass flags and no credential file names | none | only a comment saying the bypass flag is never used | PASS |
| S5 | Leak scan of all run dirs, ledgers and raw stream-json for emails, `sk-…`, `access_token`, `refresh_token`, orgId | none | no matches | PASS |

Depth-1 enforcement:
- every agent is spawned by the scripts with `AGENT_TEAM_CHILD=1`
- Claude workers get `--disallowedTools Agent Task`
- the leader never spawns agents itself; it only returns JSON
- leader-proposed nodes go through the same validator as user graphs

### 5.6 Regression checks

| Test | Check | Result | Status |
|---|---|---|---|
| R1 | Wrappers still work (`clp1 --version`, `cop1 --version`, normal calls throughout) | 2.1.323 / 0.168.0; 122 successful calls | PASS |
| R2 | No login or logout; auth state unchanged | same normalized states as preflight (clp1, cop1 LOGGED_IN; 8 NOT_LOGGED_IN) | PASS |
| R3 | Existing unmanaged skill `shared-check` unchanged | sha256 `3a4bb2ad4bd7…` (Claude), `a68a4a5b288d…` (Codex): same before and after | PASS |
| R4 | All 3 skills discovered by each CLI (real call to clp1 and cop1) | both listed `agent-team, clp, cop` (plus `shared-check`) | PASS |
| R5 | Account-dir mapping and wrappers untouched | `/usr/local/bin/clp1` 12:45:41, `lib/*.sh` 12:20:21 (before this work); no edits | PASS |
| R6 | Container still running | `devtools Up 2 hours` | PASS |

### 5.7 SKIP / BLOCKED

| ID | Item | Status | Reason |
|---|---|---|---|
| B-1 | fan-out to **3 distinct** accounts | BLOCKED | Only 2 accounts are logged in. Logging in more is not allowed. The logic was tested on 2 accounts. |
| B-2 | Quota-based load distribution + failover to another account | BLOCKED | Conflicts with "ห้ามสลับบัญชีเพื่อหลบ Rate/Usage Limit". Implemented as stop and report (IT-G). |
| B-3 | Reactive worker switch on quota, rate limit or expired login | BLOCKED | Same constraint. The node fails and dependents are blocked with the reason. |
| B-4 | Proactive worker switch at session quota ≥ 80 % | BLOCKED | Same constraint. `status` shows "near limit". Moves happen only on the user's own token budget. |
| B-5 | Leader switch on quota, rate limit or expired login | BLOCKED | Same constraint. The run stops with a report (UT `test_leader_limit_stops`). Crash, timeout and invalid-plan switches work. |
| B-6 | Real-user test with `clp2` (spec) | BLOCKED | clp2 is NOT_LOGGED_IN. clp1 was substituted, with the same model (sonnet). |
| SKIP-1 | Live "expired" readiness state | SKIP | No account is in that state. Covered by unit test of error classification. |
| SKIP-2 | Codex quota *with data* | SKIP | No non-ephemeral rollout exists, and skill calls are `--ephemeral` by spec. The "no data" path PASS. |
| SKIP-3 | Difficulty 3–6 live (opus high/xhigh/max, Codex high+) | SKIP | Not needed for any scenario. Avoids spending quota on more expensive models. Mapping covered by static review and unit test. |

## 6. Performance Metrics

| Metric | Value |
|---|---|
| Total elapsed (spec read → report) | ~41 min (13:52 → 14:33) |
| Model invocations | **130**: 122 through skill scripts (ledger), 2 preflight probes, 6 real-user orchestrator agents. Plus 2 simulated calls (0 s, no model) and `/usage` built-in reads (no model). |
| Duration per skill (ledger) | **clp**: 61 calls, 289.2 s total, avg 4.7 s, max 20.7 s · **cop**: 61 calls, 935.8 s total, avg 15.3 s, max 57.8 s (image generation) |
| Token usage (reported by the CLIs, from ledger) | clp: 1,727,279 tokens (input + cache read + cache write + output), list-price cost 1.7107 USD (not the amount actually paid) · cop: 3,483,674 tokens (Codex reports no cost) |
| Real-user orchestrator cost (CLI `total_cost_usd`) | captured for 3 of 6 runs: 0.0434 / 0.0864 / 0.0962 USD |
| Peak concurrency | **2** in all runs with `--max-parallel 2`. **3** once: the verbatim host line `lead --demo` at 14:17 ran at default settings (8 total / 3 per account), which is above the 2-agent test budget. After the D-5 fix the demo runs 1 per account (peak 2). |
| Max calls in one run | 13 (IT-B: 11 nodes + 2 readiness). Every run stayed within 20. |
| Timeouts / automatic retries | 0 / 0 |
| Manual reruns (deliberate) | s3 resume ×2; demo re-run after D-5; AB-a ×3 (one lost to harness H-1); AB-c ×2 |
| Run durations | IT-A 57.6 s · IT-B 87.8 s · IT-H 117 s · IT-I 65 s · host demo 65–73 s · AB 55–85 s |

## 7. Deployment Verification

Method:
- staging dir in the container (`/tmp/agdeploy`)
- pre-checks: no naming conflict, `shared-check` checksums recorded, mounts (`/root/ai-accounts` = volume `devtools-ai-accounts`, ext4)
- `cp -a` per skill folder; no `rsync --delete`, nothing removed
- managed files backed up to `/tmp/agtest/backup/<ts>/` before each update

| File | Source = Claude shared = Codex shared (sha256, first 16) |
|---|---|
| agent-team/SKILL.md | 2df842d7e9e74ad4 |
| agent-team/references/policies.md | 5a2b45ae41f0dfa3 |
| agent-team/scripts/engine.py | ec29c2cf28d66ff4 |
| agent-team/scripts/graph.py | 06a5d3a10a074989 |
| agent-team/scripts/leader.py | 96d0970cfa29e723 |
| agent-team/scripts/report.py | f66169574442e9e6 |
| agent-team/scripts/team.py | 930405d5663323e2 |
| clp/SKILL.md | c8c6c0613ac84ebf |
| clp/scripts/clp.py | d5b53151b97f8dcc |
| clp/scripts/macore.py | ea7914a55240e206 |
| cop/SKILL.md | d4ee7dac1edcb7b8 |
| cop/scripts/cop.py | 1ac0cea6d53bf20b |

- Final compare is order-independent: **12/12 identical** across all three locations. 0 `__pycache__` (entry scripts set `sys.dont_write_bytecode`). Executable bit kept on `clp.py`, `cop.py` and `team.py` (755).
- Deployment status: **SUCCESS**. Rollback: **not required** (no deployment step or critical test failed). Backups are kept in `/tmp/agtest/backup/`.

## 8. Known Issues, Limitations and Assumptions

### 8.1 Assumptions

| ID | Assumption |
|---|---|
| A1 | The spec is not at `./prompt_skill_spec.md`. It was found at `../Teaching_CWN2026/01_week02/04_MultiAccount_Skill/prompt_skill_spec.md` and used. The `_solution/` folder next to it was **not** opened. |
| A2 | Spec names map to this environment: `yolo`→`clp`, `cyolo`→`cop`, container `multi-account`→`devtools`. |
| A3 | Source dir is the user-specified `./devtools/.claude/skills/`, which also holds 7 existing `guide-*` skills. They were not touched. |
| A4 | Codex default model = first slug in `models_cache.json` (`gpt-6.1-sol`). The spec gives only Codex efforts. |
| A5 | Leader difficulty = 2 (Claude `sonnet/medium`, Codex `medium`). The spec does not fix it. |
| A6 | Readiness results are cached for 10 minutes (`ready_cache.json`) to avoid repeated real calls. |
| A7 | Tool defaults follow the spec (8 total / 3 per account). Tests ran with `--max-parallel 2`. Calls per run default to 20 (the user's budget). |
| A8 | `expect` regex means "found in the reply". Use `^…$` for a whole-text match. |
| A9 | Shared module `macore.py` lives in `clp/scripts/`. `cop` and `agent-team` import it as a sibling skill, which the spec allows. |
| A10 | `--demo` uses budget 1 and per-account concurrency 1 so all 3 events always occur. |

### 8.2 CLI compatibility and limitations

- If several nodes start on the same account at the same moment, a usage-limit error can only stop the nodes that start *after* it. Those already in flight finish or fail on their own (seen in IT-G: l1 and l2).
- Codex quota stays "no data" while all calls are `--ephemeral`, as the spec states.
- Each Claude worker call carries about 22k cached system-prompt tokens. This comes from the CLI, not from the skill.
- Host examples use `//root/...` (two slashes) so the same line works in PowerShell and Git Bash. Git Bash rewrites `/root/...`; this was verified.
- Claude `write: true` (`--permission-mode acceptEdits`) is implemented but was not exercised live. Codex `-s workspace-write` was exercised through image nodes.

### 8.3 Remaining manual tests

1. Log in to at least one more account per CLI, then rerun fan-out across 3 distinct accounts (B-1) and the real-user test with clp2 (B-6).
2. "Expired" readiness on a real expired session (SKIP-1).
3. Codex quota with data after a normal (non-ephemeral) session (SKIP-2).
4. Install by drag-and-drop in JupyterLab.
5. If the security policy is ever relaxed, revisit B-2 to B-5.

### 8.4 Defects found by testing (all fixed and retested)

| ID | Found by | Defect | Fix |
|---|---|---|---|
| D-1 | UT | `Scheduler.event(kind, kind=…)` keyword collision crashed every leader switch | renamed the parameter |
| D-2 | IT-A | worker preamble pushed small models to add working and `BOARD:` lines, breaking `expect int` | strict reply-format wording; BOARD only when the task asks |
| D-3 | IT-H | `expect` used a whole-text match; leader-written "contains" regexes failed, causing 2 wasted merges and exit 1 | regex search (anchors for a full match); leader prompt, SKILL.md and unit tests updated |
| D-4 | IT-I | Claude leader sometimes replied with non-JSON (handled by a switch, but wasted a call) | Claude leaders use `--json-schema` and read `structured_output` |
| D-5 | IT-I, IT-K | merge worker tried to write a file in the read-only sandbox; demo worker-move was not deterministic at default concurrency | "return result as reply text unless `write`" in preamble; demo sets 1 per account |
| D-6 | AB-a | agent used a heredoc to write the graph (blocked by Claude Code permissions) | SKILL.md: always write the graph with the Write tool; no heredoc |
| D-7 | AB-a | agent used `echo exit=$?` (blocked) | `team.py` prints `exit=N` itself; SKILL.md forbids `$?`, `$(…)` and variables |
| D-8 | AB-c | agent ran an unneeded `mkdir` for `image_out` | SKILL.md: the folder is created automatically |
| D-9 | IT-M | `--json` output mixed with progress lines | progress goes to stderr when `--json` is set |
| D-10 | IT-F | `tokens(run)` printed as a float | cast to int |
| H-1 | AB-a | (test harness, not the skill) stream-json parser crashed on a string `message` | fixed in `ux.py` |
