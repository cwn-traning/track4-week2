# TEST-REPORT — Skill `dag-planner` (DAG · Gantt · AT-QUEST · agent-team export · simulation)

Date: 2026-11-13 · Environment: container `devtools` (running, 0 restarts) + Windows host
This report contains no credentials, tokens, API keys, emails or account identity data. Account names (`clp1`, `cop1`, …) are slot labels only.
Report of `/devtools:07-dag-planner`. The agent-skills report (`/devtools:06-agent-skills`) is `devtools/workspace/reports/agent-skills/TEST-REPORT.md`.

## 1. Executive Summary

| Item | Result |
|---|---|
| Overall status | **PASS for simulation scope**. Real-execution scope: **NOT TESTED** (by constraint). |
| Tests (container, runtime copy, `.Claude` and `.Codex`) | **56 PASS · 0 FAIL · 0 SKIP** each |
| Tests (Windows host, stdlib Python 3.13) | 48 PASS · 0 FAIL · 8 SKIP (simulation needs POSIX; `jsonschema` not installed) |
| Spec test items 1–8 | 7 PASS · 1 PARTIAL (item 4: real quota → SKIP, fixture/assumed quota → PASS) |
| Requirement coverage | 41 requirements traced. 38 PASS, 1 PARTIAL, 2 SKIP (real execution / real quota) |
| Deployment | **Deployed** to both shared skill dirs. Checksums match the source (20 files, tree `89a7082ea68de874`). |
| Real executor invocations | **0** (shim counter, every simulated run) |
| Real AI inference / model API / auth operations | **None** |
| Base skills, reference implementation, wrappers, unmanaged skills | **Unchanged** (checksums before = after) |

## 2. Inputs and conflicts found (documented, not "fixed")

| # | Conflict | Decision |
|---|---|---|
| K1 | The brief's paths `./prompt_dag_skill_spec.md`, `./base_skills`, `./tools/*` do not exist in `workshop/week2`. | The user chose `Teaching_CWN2026/01_week02/05_DAG_Planner/` as the read-only source of truth. |
| K2 | The spec's base skills are `yolo`/`cyolo`/`agent-team` (container `multi-account`). The brief and the real runtime use `agent-team`/`clp`/`cop` (container `devtools`). These are different code: no `--dry-run`, no `check --json`/`quota --json`, no `validate_graph()`. | Built against the **installed runtime** (identical to `./devtools/.claude/skills`). Skill names `yolo`/`cyolo` are kept as block skills and map to `clp`/`cop`. Validation uses the real `graph.expand()`. |
| K3 | The spec says to read real quota via `team.py quota --json`. In this runtime `quota` starts each account's CLI, which is an authenticated session. | `plan` uses `--accounts` (assumed) or `--quota-json` (fixture) only. Live quota → **SKIP**. |
| K4 | `doctor` must show ready accounts via `team.py check`, but that makes a **real model call**. | `doctor` lists accounts (wrapper + dir) with readiness **UNKNOWN**. A real check only runs with explicit `--check-accounts`, which was not used. |
| K5 | The spec expects failover to planned accounts. agent-team policy: **no failover** on limit/auth, and pinned accounts never move. | Single-account blocks are exported as a side (`clp`/`cop`) and the router picks within `--workers`. debate/best_of are pinned to the planned, distinct accounts. Documented in `references/run.md`. |
| K6 | The algorithm name in the reference is organisation-specific. | Renamed to the neutral **AT-QUEST** (Agent · Team · Quota · Urgency · Expiry · Scheduling · Technique) everywhere: files `atquest.py`/`atquest.md`, outputs, docs, command 07. Formulas and weights come from reference `tools/orch.py` `DEFAULT_CFG`, unchanged. |
| K7 | The agent-team simulator (`MA_SIMULATE_LIMIT`) only simulates **usage-limit failures**. There is no simulated success or duration. | The simulated "actual" timeline = root nodes fail (rate_limit) and dependants are blocked. This shows the run→report contract only, not successful execution. |
| K8 | In agent-team, `debate`/`best_of` run read-only (no file writes). | Prompts ask for reply text. Dependants read `{{file:<id>}}`. Found by the independent review and fixed. |

## 3. Architecture

Source: `./devtools/.claude/skills/dag-planner/` (Python 3.8+, stdlib only)

| Logical component | Implementation |
|---|---|
| Requirement Analyzer / Task Decomposer | AI, following `SKILL.md` rules + `references/blocks.md` (6–14 blocks, skill table) |
| DAG Builder + Validator | `scripts/blocks.py`: ids, duplicates, self/missing deps, cycles (Kahn), skill/size/difficulty/output safety, rank, critical path, exclusivity edges, file-ownership conflicts |
| AT-QUEST (AT-QUEST) Evaluator | `scripts/atquest.py`: hard constraints (ready, quota known, not expired, CLI side, capacity, slot) **before** scoring. U/F/R/V/L/B weights 0.40/0.20/0.15/0.15/−0.10/0. Ported from `orch.py`. |
| Resource Scheduler | `scripts/schedule.py`: event-driven list scheduling. MRV → rank → size → id. Reserve-on-assign. Multi-account blocks are all-or-nothing. Team limit, per-account slots, exclusive, file locks. Infeasible → `unassigned` + descendants → plan `BLOCKED`. |
| Result Validator | `schedule.validate_schedule`: completeness, deps, exclusivity, file overlap, slots, team limit, CLI/role rules, cumulative quota ≤ headroom |
| Execution Plan Generator | `plan.json` (`dag-planner/plan@1`, schema in `schemas/`). This is the canonical data; DAG, Gantt and graph.json are all derived from it. |
| Simulator Adapter | `scripts/export.py` (graph.json validated by agent-team `graph.expand()`) + `scripts/runner.py` (sandboxed `team.py run`) |
| DAG / Gantt Renderers | `scripts/render.py`: SVG (+PNG via headless Chrome where available). Skill badges ×6, critical path, legend, lanes for parallel slots, linked multi-account bars. |
| Reports | `scripts/reports.py`: `PLAN.md`, `REPORT.md`, `compare.svg`, calibration k (real runs only) |

**Simulation boundary (runtime-enforced in `runner.py`):** a private `AGENT_TEAM_HOME` inside the plan; a synthetic `ready_cache.json` there, so team.py skips its real readiness call; `MA_SIMULATE_LIMIT` set to every worker; `PATH` = counting shims (`clp1–99`, `cop1–99`, `claude`, `codex`) + `/usr/bin:/bin` (no `/usr/local/bin`); `--no-quota`. Simulation is refused on non-POSIX hosts and with `--detach`. `--real` is refused when `DAGPLAN_SIMULATE_ONLY=1`, which was set for every test.

**Execution Plan contract (graph.json):** node keys ⊂ agent-team `NODE_KEYS`. `yolo`/`cyolo` → `account: clp|cop`, `kind: code`, `cwd` = `app/`, `write: true`. `image` → `kind: image` + `image_out`. `review` → `type: review` + `reviewer.account` = other CLI. `debate`/`best_of` → `accounts` + `judge` from the plan. `depends_on` = declared + exclusivity edges. The `dagplan` block carries the schema id, the blocks sha256, workers and limits, which are passed as `--max-parallel`/`--per-account`.

Not ported from `orch.py`: relay/mid-task hand-off (⑨⑩), because agent-team cannot move a running node. Workers, postgres and infra are unrelated.
Assumption not in the reference: the reviewer/judge cost is 30 % of block size.
The schedule is a validated greedy heuristic and **not claimed optimal**.

## 4. Requirement Traceability Matrix

| Req ID | Requirement (source) | Implementation | Test ID | Status |
|---|---|---|---|---|
| SPEC-T1 | Deployed; accounts see SKILL.md; doctor shows base skills | deploy + `sync_skills` replay; `doctor` | DEP-1..3 | PASS (see §7) |
| SPEC-T2 | `dag` catches cycle / dup id / missing id / unknown skill | blocks.validate | C08, D07, D09, D10, D11 | PASS |
| SPEC-T3 | 8-block, 6-skill sample: skill badges, rank and critical path correct (independent) | render_dag, ranks | C09, D12 | PASS (PNG on host; container has no Chromium → SVG) |
| SPEC-T4 | plan **from real quota**: right CLI, review on another CLI, no slot overrun, multi-row Gantt | schedule, validator | S17, C06 | **PARTIAL**: logic PASS with fixture/assumed quota; real quota SKIP (K3) |
| SPEC-T5 | `--accounts` with a low account → no big block | AT-QUEST capacity | S16, ART-2 | PASS |
| SPEC-T6 | `export` accepted by agent-team | export + graph.expand | C01, C03 | PASS |
| SPEC-T7 | run→report via `MA_SIMULATE_LIMIT`, statuses = state.json, tokens = ledger | runner, reports | C10, C14 | PASS |
| SPEC-T8 | from host via docker exec; host `dag`+`plan --accounts` without container | SKILL.md "เรียกจาก host" | HOST-1, HOST-2, host suite | PASS |
| REQ-DAG-1..5 | empty/single/sequential/parallel/diamond/multi-dep/cycle/self/dup/missing/exclusive | blocks.py | D01–D13 | PASS |
| REQ-ATQ-1 | multiple eligible → top score + reasons | choose_account, PLAN.md | S02 | PASS |
| REQ-ATQ-3 | quota unavailable / reservations ≤ headroom | slots, capacity, _quota_errors | S08, S20 | PASS |
| REQ-ATQ-4 | urgency (critical rank) priority | MRV + crit ordering | S06 | PASS |
| REQ-ATQ-5 | expiry: U factor, expired excluded, unknown flagged | score_accounts | S07, S10, S11 | PASS |
| REQ-ATQ-6 | UNKNOWN ≠ available (quota, readiness) | _hard_check | S09, S12 | PASS |
| REQ-SCH-1..7 | single account, capacity, team limit, file conflict, determinism, infeasible, exclusive | schedule.py | S01, S03–S05, S13–S15, S19 | PASS |
| REQ-VAL-1 | independent schedule validation | validate_schedule | S18, S19, S20 | PASS |
| REQ-EXP-1..5 | schemas, BLOCKED not exportable, rejected graph, stale blocks/graph, reply-only blocks | export.py, runner.py | C05, C02, C03, C04, C13, C12 | PASS |
| REQ-CON-1 | DAG, Gantt, export from one canonical plan | plan.json | C06 | PASS |
| REQ-CON-2 | planned vs actual separated | plan.json immutable after run | C11 | PASS |
| REQ-REP-1 | report maps sub-nodes and tokens | runner.actual_bars/block_tokens | C14 | PASS |
| REQ-SEC-1 | simulation-only enforced at runtime; `--real` refused | runner | X01, X03 | PASS |
| REQ-SEC-2 | real executor count = 0 (with positive control) | shims | X02 | PASS |
| REQ-SEC-3 | no eval/shell; safe output paths | static + validation | X06, D14 | PASS |
| REQ-SEC-4 | prompt placeholder injection | `_safe()` | C07 | PASS |
| REQ-SEC-5 | shared agent-team home untouched | private home | X04, REG-4 | PASS |
| REQ-SEC-6 | base skills unchanged | — | X05, REG-1 | PASS |
| REQ-SEC-7 | no credential / auth access | static scan | X07 | PASS |
| REQ-SKL-1 | valid frontmatter, bilingual triggers | SKILL.md | X08 | PASS |
| REQ-REG-1..4 | base/unmanaged skills, wrappers, container unchanged | — | REG-1..4 | PASS |
| REQ-RUN-REAL | `run --real` + calibration k from real runs | runner (`--real`), `calibrate()` | — | **SKIP**: needs real tokens |
| REQ-QUOTA-LIVE | read live quota | — (not implemented, K3) | — | **SKIP** |

## 5. Test Results

Evidence files: `devtools/workspace/reports/dag-planner/artifacts/test-results-container-claude.json`, `…-codex.json`, `…-host.json` (per test: id, requirement, expected [docstring], status, duration, evidence).
Fixtures: `fixtures/sample8.json` (8 blocks, all 6 skills) and synthetic accounts in `tests/helpers.py` (fixed clock 2026-11-13T09:00+07:00). Expected results are in each test's docstring (§4 column "Requirement"). Actual result = assertion outcome.

### Unit / contract / security suite (container, runtime copy) — 56/56 PASS

| Group | Tests | Expected (summary) | Actual | Status |
|---|---|---|---|---|
| DAG | D01–D14 | errors detected; rank equals a brute-force longest path; critical path B01→B04→B07→B08 | as expected | 14 PASS |
| Scheduling | S01–S20 | constraints hold, BLOCKED when infeasible, 10 identical runs | as expected | 20 PASS |
| Contract | C01–C14 | expand() accepts; stale/BLOCKED refused; schemas valid; DAG = Gantt = graph | as expected | 14 PASS |
| Security | X01–X08 | private home, 0 real calls (shim counts 1 on the positive control), `--real` refused, canary untouched | as expected | 8 PASS |

Durations: the full suite took 2.2 s wall time in the container and 13.9 s on the host. Per-test durations are in the JSON. The simulation tests (C10, C11, X01–X05) show ~0 s because the shared simulated run happens in `setUpClass`.

### Integration evidence (container, deployed copy, from the host via `docker exec`)

| ID | Command | Expected | Actual (sanitized) | Status |
|---|---|---|---|---|
| HOST-1 | `docker exec -i devtools python3 …/dagplan.py dag meow --blocks - < sample8.json` | OK, critical path | `OK 8 blocks · critical path B01 → B04 → B07 → B08` | PASS |
| HOST-2 | `plan meow --accounts clp1,clp2,cop1,cop2:40 --now …` → `export` → `run` → `report` | OK plan, graph accepted, 0 real calls, report written | `OK · makespan 65.9 min · peak 8 agents · unassigned 0` · `8 nodes → 12 expanded` · `simulation run 20261113-162356-423 rc=1` · `real executor invocations: 0` · `SIMULATED run …: blocked=7, failed=1` | PASS |
| ART-2 | `plan whatif --accounts clp1:8,clp2,cop1,cop2` | clp1 gets no L block | clp1 is assigned nothing; B04 (L) → clp2 | PASS |
| SIM-1 | team.py argv | sandbox + limits | `run graph.json --workers clp1,clp2,cop1 --json --max-parallel 8 --per-account 3 --no-quota`, `AGENT_TEAM_HOME` = plan sandbox | PASS |

rc=1 from team.py is **expected**: in simulation every started node fails with `SIMULATED usage limit`.

## 6. Scheduling Metrics (sample8, accounts clp1, clp2, cop1, cop2@40 %, fixed clock)

| Metric | Value | Clock |
|---|---|---|
| Planned makespan | **65.9 min** | simulated plan clock |
| Critical path (B01→B04→B07→B08) duration | **63.1 min** | simulated plan clock |
| Peak planned concurrent agents | 8 (= `--max-agents 8`) | simulated plan clock |
| Resource utilization (busy slot-minutes ÷ makespan; >1 means parallel slots) | clp1 0.625 · clp2 0.71 · cop1 1.033 · cop2 0 (40 % account not needed) | simulated plan clock |
| Simulated actual makespan | 0.05 min: B01 failed (simulated limit), 7 blocked | harness wall clock |
| Peak simulated concurrency | 1 (only the root node could start) | harness wall clock |
| Real executor invocation count | **0** | — |
| Test harness wall time | container 2.2 s · host 13.9 s | real time |

The simulated actual timeline does **not** measure model work and must not be compared with the planned makespan as performance evidence (K7).

## 7. Deployment Verification

| Item | Value |
|---|---|
| Source | `./devtools/.claude/skills/dag-planner/` (20 files, tree sha256 prefix `89a7082ea68de874`) |
| Staging | `/tmp/dagplan-stage` in the container: compile + 56 tests PASS before deploy |
| Runtime | `/root/ai-accounts/.Claude/shared/skills/dag-planner` and `/root/ai-accounts/.Codex/shared/skills/dag-planner`: both **MATCH** the source (`89a7082ea68de874`) |
| Pre-check | target absent in both dirs (no unmanaged conflict). No account has an entry named `dag-planner`. |
| Base skills (`agent-team`, `clp`, `cop`) | Runtime = `./devtools/.claude/skills` checksum for checksum (12 files each side) → **not redeployed** |
| DEP-3 discovery | Real `/root/ai-accounts/lib/sync-skills.sh` `sync_skills` replayed into a temp dir: links `dag-planner` for Claude and Codex, SKILL.md readable. Account dirs are linked by the wrappers on next launch (not launched: that would start a CLI session). |
| `doctor` from runtime | finds sibling base skills, python 3.12.3, "no headless Chromium → SVG only" |
| REG-1 unmanaged + base skills (excl. dag-planner) | aggregate sha `3bfab0f9…`, before = after |
| REG-2 wrappers `clp1–5`/`cop1–5` | aggregate sha `ef116c0c…`, before = after |
| REG-3 container | `running`, StartedAt unchanged, RestartCount 0 |
| REG-4 shared `/workspace/.agent-team/ledger.jsonl` | 32 lines, sha `e09128c0…`, before = after |
| `__pycache__` in runtime | 0 |
| Rollback | not needed. Rollback scope = remove only the two `dag-planner` dirs created by this work. |

Source spec, `base_skills/` and `tools/planner.py`/`orch.py` in `05_DAG_Planner` were only read (no write operations issued).

## 8. Known Issues and Limitations

- **Not tested (constraint):** real `run --real`, real agent output, calibration k from real runs, live quota reading, real `team.py check`. None of the simulation results show that real execution succeeds.
- **SPEC-T4 PARTIAL:** "plan from real quota" is replaced by fixture/assumed quota (K3).
- **PNG:** the container has no headless Chromium, so the in-container outputs are SVG only (spec fallback). PNGs were rendered on the host with Chrome: `devtools/workspace/reports/dag-planner/artifacts/container-sim/*.png` and `devtools/workspace/reports/dag-planner/artifacts/host/meow/*.png`.
- **Simulator depth (K7):** only failure/blocked paths are exercised end to end. Success-path mapping for review rounds and debate sub-nodes is covered by a synthetic-state unit test (C14), not a live run.
- **Planned vs actual accounts:** single-account blocks go to a side, so actual accounts may differ from the plan (K5). `report` shows the difference.
- **Durations** are estimates: size ÷ CLI speed (orch.py), with reviewer/judge at 30 % (dag-planner assumption) run after the main work.
- **Lint:** flake8 shows style-only findings (line length, lambda assignment); no errors.
- **Independent review:** a code-reviewer agent found 1 HIGH (debate/best_of output contract) and several MEDIUM issues (stale graph, plan limits not passed to team.py, vacuous X04, missing validator checks, detach/Windows boundary). All were fixed and covered by C12–C14, S19, S20 and X04 before deployment.
- **Assumptions:** the source-of-truth folder (K1, confirmed by the user). Account slot cap = min(orch per-kind max, agent-team `--per-account` 3).

## 9. Files

- Skill: `SKILL.md` · `scripts/{dagplan,blocks,atquest,schedule,export,runner,render,reports}.py` · `references/{blocks,atquest,run}.md` · `schemas/{blocks,plan}.schema.json` · `fixtures/sample8.json` · `tests/{helpers,run_tests,test_dag,test_schedule,test_contract}.py`
- Example outputs: `devtools/workspace/reports/dag-planner/artifacts/container-sim/` (dag, gantt-plan, gantt-actual, compare .svg/.png, PLAN.md, REPORT.md, plan.json, graph.json, run.json, whatif-PLAN.md) · `devtools/workspace/reports/dag-planner/artifacts/host/meow/`
- Rename to AT-QUEST: redeployed 16:23 (backup `/tmp/dagplan-backup/20261113162319` in container); runtime grep for old name = none; all tests re-run 56/56 per side.
- Time: build + test + deploy phase ≈ 21 min wall (file and run timestamps 15:45–16:06). The earlier analysis and preflight phase was not timed separately.
