# Task Breakdown: Agents of Lore Self-Learning Hooks

## Phase 1: Setup & Foundation

- [ ] T001 [P] Create hook integration layer in `mcp-server/src/hooks.ts` — define HookRegistry, HookContext, and hook lifecycle (before_context_assembly, after_search_memory, before_pipeline_task, after_task_complete)
- [ ] T002 [P] Extend MCP tool signatures in `mcp-server/src/tools/` — add `hook_name` and `hook_metadata` fields to all context/memory/pipeline tool responses for hook tracing
- [ ] T003 [P] Create agent hook executor in `agent/src/hooks/executor.ts` — loads and validates hook definitions from `agents/{agent_id}/hooks.yaml`, executes hooks with timeout + error handling, logs execution to audit trail
- [ ] T004 [P] Set up hook definition schema in `specs/agent-hooks-spec/hook-schema.yaml` — define hook types (fact_extractor, pattern_detector, feedback_loop, autonomy_rule), input/output schemas, execution order
- [ ] T005 Define hook storage layer in `mcp-server/src/schema/hooks.sql` — tables for hook_definitions, hook_executions, hook_results, hook_feedback with audit timestamps

## Phase 2: Core Self-Learning Implementation

- [ ] T006 [P] Implement fact extraction hook in `agent/src/hooks/fact-extractor.ts` — post-search_memory hook that identifies new facts from search results, scores confidence, writes back via write_memory with auto-invalidation logic
- [ ] T007 [P] Build pattern detector hook in `agent/src/hooks/pattern-detector.ts` — analyzes completed tasks (multi-entry point: after_task_complete, after_pr_created, after_review_completed), extracts repeated patterns (error handling, deployment gotchas, code review feedback), stores as queryable memories
- [ ] T008 [P] Create autonomy rule engine in `agent/src/hooks/autonomy-rules.ts` — evaluates learned patterns to auto-decide: skip manual approvals for low-risk changes, parallel task execution thresholds, fallback strategies
- [ ] T009 Implement feedback loop in `agent/src/hooks/feedback-loop.ts` — captures human review corrections on agent PRs (via GitHub PR comments parsed by review-reactor), inverts to corrective facts, invalidates conflicting learned patterns
- [ ] T010 Build entry point dispatcher in `agent/src/entry-points.ts` — routes agent invocations through multiple entry points (GitHub Issue label, Web UI task creation, direct MCP call, scheduled job trigger), normalizes context for each
- [ ] T011 Create memory coalescing system in `mcp-server/src/memory/coalesce.ts` — merges duplicate or overlapping memories (similarity threshold 0.88), keeps versions, updates knowledge graph edges to reflect consolidation

## Phase 3: Integration & Multi-Entry Points

- [ ] T012 [P] Wire hooks into context assembly in `mcp-server/src/tools/assemble-context.ts` — run before_context_assembly hook before fetching, post-process results with after_context_assembly hook, include hook execution metadata in response
- [ ] T013 [P] Integrate hooks into memory search in `mcp-server/src/tools/search-memory.ts` — after search returns, run pattern_detector hook on top results, append learned patterns as context enrichment
- [ ] T014 [P] Add hooks to pipeline task creation in `agent/src/jobs/task-processor.ts` — before task starts (autonomy rule check: can this skip approval?), after completion (fact extraction + pattern detection)
- [ ] T015 Connect GitHub Issue entry point in `agent/src/entry-points/github-issue.ts` — parse issue labels/body, extract seed query, create task with metadata linking back to Issue, route through hooks before agent work starts
- [ ] T016 Connect Web UI entry point in `web-ui/src/api/tasks.ts` — task creation endpoint runs autonomy rules (pre-check if needs approval), stores hook execution chain in task metadata, surfaces hook decisions in UI
- [ ] T017 Connect scheduled job entry point in `agent/src/entry-points/scheduled-jobs.ts` — gap-detection, spec-drift, autoresearch jobs all route through hooks for self-modification of task parameters
- [ ] T018 Build hook execution visualizer in `web-ui/src/app/pipeline/[id]/HookExecutionChain.tsx` — show hook execution timeline per task, display extracted facts, pattern decisions, autonomy rule results

## Phase 4: Autonomous Behavior & Feedback

- [ ] T019 Implement self-modifying task parameters in `agent/src/hooks/autonomy-rules.ts` — learned patterns can adjust parallelization level, timeout thresholds, approval gate decisions for future tasks of same type
- [ ] T020 Create feedback loop capture in `agent/src/jobs/review-reactor.ts` — when human corrects agent PR, parse feedback, extract corrective fact, run through fact-extractor hook to store as "this pattern was wrong"
- [ ] T021 Build fact invalidation trigger in `mcp-server/src/memory/invalidation.ts` — when corrective fact is written, find all active memories with cosine similarity >= 0.88, auto-invalidate them, log cascade
- [ ] T022 Implement learning dashboard in `web-ui/src/app/learning/index.tsx` — show learned facts per agent, confidence scores, invalidation history, pattern frequencies, autonomy rule trigger counts
- [ ] T023 Add hook dry-run mode in `agent/src/hooks/executor.ts` — append `--dry-run` flag to see what hooks WOULD do before committing, helps debug hook chains
- [ ] T024 Create hook rollback mechanism in `agent/src/hooks/rollback.ts` — if hooks cause task failure, revert to last known-good hook state, log divergence point

## Phase 5: Testing & Hardening

- [ ] T025 [P] Write hook integration tests in `mcp-server/__tests__/hooks.test.ts` — test fact extraction, pattern detection, autonomy rule evaluation in isolation
- [ ] T026 [P] Add multi-entry-point e2e tests in `agent/__tests__/entry-points.e2e.ts` — verify GitHub Issue, Web UI, MCP, and scheduled job routes all trigger same hook chain
- [ ] T027 [P] Test feedback loop in `agent/__tests__/feedback-loop.e2e.ts` — create agent task, human corrects PR, verify corrective fact is captured and invalidates conflicting memories
- [ ] T028 Add hook performance benchmarks in `agent/__tests__/hooks.perf.ts` — measure fact extraction, pattern detection latency at scale (1000+ memories, 100+ patterns)
- [ ] T029 Create chaos test for hook failures in `agent/__tests__/hooks.chaos.ts` — kill DB mid-hook, network timeout, malformed hook YAML; verify graceful fallback
- [ ] T030 Add hook audit log validator in `mcp-server/__tests__/audit.test.ts` — verify every hook execution is logged, timestamps are monotonic, no gaps in execution chain

## Phase 6: Documentation & Ops

- [ ] T031 Write hook developer guide in `docs/HOOKS.md` — how to write custom hooks, hook registry, examples (fact extractor, pattern detector, autonomy rule), testing hooks locally
- [ ] T032 Document self-learning workflow in `AGENTS.md` — how agents learn from corrections, memory invalidation, pattern reuse, multi-entry-point dispatch, feedback loops
- [ ] T033 Create runbook for hook debugging in `docs/RUNBOOK-HOOK-DEBUG.md` — common issues (hook timeout, fact extraction fails, autonomy rule blocks legitimate task), diagnostics, recovery steps
- [ ] T034 Add hook configuration guide in `docs/CONFIG-HOOKS.md` — enable/disable per-agent, set confidence thresholds, tune invalidation similarity (0.88 default), parallelization limits from learned patterns
- [ ] T035 Update ops dashboard in `web-ui/src/app/ops/hooks.tsx` — hook health (success/failure rate), learned facts trending, autonomy rule trigger rate over time, memory coalescing stats
- [ ] T036 Write deployment guide in `terraform/modules/agent-helm/HOOKS-DEPLOY.md` — deploy agent with hook system enabled, monitor hook execution via OpenTelemetry traces, set alerts for hook failure spikes

---

**Notes:**

- **[P] tasks** can run in parallel within their phase
- Tasks T001–T005 establish the foundation; T006–T011 implement core logic; T012–T018 wire everything together across entry points; T019–T024 add autonomous behavior; T025–T030 harden; T031–T036 document and operationalize
- All file paths match the actual repo structure visible in context
- Each task is specific enough for an engineer or agent to execute without asking for clarification
- Multi-entry-point dispatch (GitHub Issue, Web UI, MCP, scheduled jobs) is the core requirement — hooks run the same learning logic regardless of how the agent is invoked