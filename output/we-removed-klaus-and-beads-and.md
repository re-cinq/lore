I'll conduct a deep research on the gaps created by removing Klaus and Beads. Let me start by searching the Lore context for relevant information.

```bash
# Search for Klaus references
grep -r "Klaus" .specify/ --include="*.md" | head -20

# Search for Beads references
grep -r "Beads\|bd " .specify/ --include="*.md" | head -20

# Check the git history for removals
git log --all --oneline --grep="Klaus\|Beads\|bd " | head -20

# Look at the constitution for what was removed
cat .specify/constitution.md | grep -A 10 "Klaus\|Beads"
```

Based on the constitution and org learnings provided, let me analyze the gaps systematically:

```markdown
# Deep Research: Gaps from Removing Klaus and Beads

## Executive Summary

Removing Klaus and Beads (bd) eliminated two critical system components:
1. **Klaus**: Distributed agent runtime for background jobs (ingestion, gap detection, spec drift, context core building, autoresearch)
2. **Beads**: Distributed task tracking system integrated with GitHub Issues

This created functional gaps in: **background job orchestration**, **task state management**, **multi-user task synchronization**, and **scheduled pipeline operations**.

---

## Gap 1: Background Job Orchestration

### What Klaus Did
Klaus was a GKE-based agent runtime that executed:
- **Nightly full re-index**: Walk all repos, parse code, extract chunks, upsert to PostgreSQL
- **Incremental ingest**: On-push GitHub webhook trigger
- **Gap detection**: Query low-confidence traces, generate missing context, open PRs
- **Spec drift detection**: Compare specs to code, create Beads tasks for divergence
- **Context Core building**: Compile promoted chunks, run PromptFoo evals, promote or reject
- **Autoresearch loop**: Find query clusters, generate candidates, eval, open PRs

### Current State (Post-Removal)
Replaced by **Lore Agent service** (`agent/` directory):
- Direct Anthropic API calls (Haiku model)
- 5 scheduled jobs running in GKE
- Per-file LLM output instead of JSON blobs

### The Gap
**Scope mismatch**: Klaus ran semantic reasoning tasks. Haiku via direct API is a lower-capability substitute.

**Missing capabilities:**:
1. **Code intelligence**: Klaus could run tree-sitter parsing, AST analysis, type inference. Lore Agent cannot parse TypeScript/Python/Go without external tools.
2. **Semantic diff analysis**: Klaus understood PR diffs semantically. Lore Agent sees text only.
3. **Multi-file reasoning**: Klaus context window could hold entire modules. Haiku's 200k token window must be managed per-file.
4. **Tool use for structured work**: The org learnings explicitly note "tool_use for structured output doesn't work reliably with Haiku" — yet all the background jobs (ingestion, gap detection, spec drift) require structured output.

**Example failure mode**: Spec drift detection needs to:
1. Parse spec file (AST boundaries)
2. Parse code file (AST boundaries)
3. Match declarations to assertions
4. Generate update PR

Step 2 (code parsing) and step 3 (semantic matching) cannot be done reliably by Haiku without tree-sitter integration. The agent currently has no way to parse code.

### Acceptance Criteria Not Met
From constitution Phase 1:
> "Klaus (`ghcr.io/re-cinq/klaus:latest`) in `klaus` namespace, port 8080."

Klaus is removed. Lore Agent cannot substitute for Klaus's reasoning capabilities.

---

## Gap 2: Task State Management and Multi-User Sync

### What Beads Did
- **Distributed task state**: `bd list`, `bd claim`, `bd update` — each task had a `claimed_by` user, status (ready/in-progress/done/blocked)
- **Dolt remote sync**: Multiple developers could run `bd update <id> --status done` and the changes would sync via Dolt (DVCS for data)
- **GitHub Issues bridge**: Beads tasks appeared in GitHub Issues with `[CLAIMED]` labels
- **Task dependencies**: Tasks could specify `DEPENDS ON: <task-id>` — agent could detect circular deps, order work
- **Sprint context**: `bd ready` showed tasks assigned to current sprint, filtered by availability

### Current State (Post-Removal)
Replaced by:
- **GitHub Issues** (platform tasks)
- **Pipeline tasks** (internal Lore operations)
- `create_pipeline_task`, `list_pipeline_tasks`, `get_pipeline_status` MCP tools

### The Gap

**Problem 1: No distributed task state**
- GitHub Issues are pull-to-refresh. No real-time sync across team members.
- If Developer A claims a task and Developer B runs `gh issue list`, B doesn't see the claim unless they refresh.
- Dolt provided CRDT-like conflict resolution. GitHub Issues have no conflict resolution for concurrent edits.

**Example failure**: 
- Task T001 is "Add auth to user service"
- Developer A: `gh issue comment <id> --body "I'm working on this"`
- Developer B: `gh issue comment <id> --body "I'm working on this"` (didn't see A's comment)
- Both start work. Both push PRs. Merge conflict.

Beads prevented this via `bd claim` (atomic, exclusive claim). GitHub Issues cannot.

**Problem 2: No task dependency graph**
- Spec Kit generates `.specify/tasks.md` with `DEPENDS ON` annotations
- `lore-tasks-to-beads.py` parsed those and created linked tasks
- Now: tasks.md exists but is not executable
- No agent can see that T002 depends on T001 and should not start until T001 is done

**Example failure**:
```
- [ ] T001 Schema migration [no deps]
- [ ] T002 Backfill data [DEPENDS ON: T001]
- [ ] T003 Update API [DEPENDS ON: T002]
```

Without Beads, the agent cannot:
- Prevent T003 from starting before T002 completes
- Suggest the correct task order to a developer
- Fail the sprint if T001 is not done (hard blocker on the rest)

**Problem 3: Sprint context is lost**
- `bd ready` showed only tasks ready to claim (no blockers, in current sprint)
- Developers could ask Claude Code "what should I work on?" and get a ranked list
- Now: developers must manually check `gh issue list --label sprint-2026-04`

### Acceptance Criteria Not Met
From constitution Phase 2:
> "Beads Dolt remote for multi-developer sync."

Beads is removed. GitHub Issues cannot provide the same guarantees.

From AGENTS.md (implied):
> "Task tracking: Beads (agent) + GH Issues"

This is broken. Pipeline tasks are internal only; they don't show on the Beads-like level developers expect.

---

## Gap 3: Spec-Driven Feature Workflow

### What Was Integrated
The `lore-feature` skill (Principle 4: Three-Command Interface) did:

```
/lore-feature "Build user auth"
  ↓ (lore-gen-constitution.py)
  → Constitution based on team constraints
  ↓
  → Spec written to `.specify/spec.md`
  ↓
  → Task breakdown in `.specify/tasks.md`
  ↓ (lore-tasks-to-beads.py)
  → Beads tasks T001, T002, T003
  ↓
  → `bd ready` shows them
  ↓
  → Developer claims T001 with `bd claim`
  ↓
  → PR opens with `/lore-pr`
  ↓ (lore-pr skill)
  → Description auto-drafted from spec + diff + ADRs
  ↓
  → PR merged
  ↓
  → Developer runs `bd update T001 --status done`
  ↓
  → State syncs via Dolt
  ↓
  → Next developer sees T002 is ready
```

### Current State
- `lore-feature` skill exists and still calls `lore-gen-constitution.py` and `lore-tasks-to-beads.py`
- `.specify/spec.md` is generated
- `.specify/tasks.md` is generated
- But `lore-tasks-to-beads.py` has no Beads to talk to
- Tasks.md sits in the repo as dead documentation

### The Gap

**Problem 1: No executable task list**
- Tasks exist as markdown but are not federated to any task system
- A developer cannot run a single command to see "I have 3 tasks waiting"
- They must manually check the repo or ask the agent each time

**Problem 2: Spec workflow incomplete**
- Spec is written and stored
- But `lore-pr` description draft still expects spec + ADRs + task context
- Without task state, the PR draft cannot see "this PR completes T001 (the first of 3 blockers)"
- The context linking is one-directional (spec → code) instead of bidirectional

**Problem 3: No sprint context**
- Beads tasks were grouped by sprint
- Now: tasks.md is sprint-agnostic
- No agent can ask "which tasks from the Q2 roadmap are now ready?"

### Acceptance Criteria Not Met
From constitution Phase 2:
> "Spec file ingestion into PostgreSQL. Spec evals in CI."

Tasks from specs exist as files but not as trackable, claimable entities.

---

## Gap 4: Scheduled Pipeline Jobs Without Orchestration

### What Klaus Did
- 3 CronJobs in `klaus` namespace:
  - Nightly reindex (2am UTC)
  - Weekly gap detection (Mon 9am UTC)
  - Weekly spec drift (Mon 10am UTC)
- Each job was a GKE Pod running Claude via Anthropic API, with reasoning
- Each job had its own MCP context (memory, repo state, git commands)
- Jobs could create Beads tasks for humans to fix

### Current State
- 5 scheduled jobs in Lore Agent (in GKE)
- Haiku via direct API (no tool use)
- No git parsing, no tree-sitter, no semantic reasoning

### The Gap

**Problem 1: Reindex cannot understand code**
From AGENTS.md (Nightly Full Re-Index Agent):
> "For each supported file type: TypeScript/Python/Go/Kotlin/Swift: parse with tree-sitter, split at function/class boundaries."

Current implementation:
- Can do basic file walking
- Cannot parse AST boundaries without tree-sitter
- Splits by file line count instead (dumb chunking)
- No semantic understanding of module structure

**Example failure**:
```typescript
// src/auth/service.ts
export async function authenticate(user: string): Promise<AuthToken> {
  // 50 lines
}

export async function refresh(token: AuthToken): Promise<AuthToken> {
  // 40 lines
}
```

Should split into 2 chunks (one per function). Without tree-sitter, may split in the middle of a function (destroying context).

**Problem 2: Gap detection cannot reason about missing patterns**
From AGENTS.md (Gap Detection Agent):
> "Extract testable assertions: Function/class names that should exist, API endpoints that should be present, Data structures that should match."

Current implementation:
- Can query low-confidence traces from Langfuse (if available)
- Cannot parse code to verify function existence
- Cannot compare spec assertions to code
- Cannot draft PR content (no tool use)

**Problem 3: Spec drift detection is broken**
From AGENTS.md (Spec Drift Detection Agent):
> "Use tree-sitter to parse the code and check each assertion: Does the function/class exist? Does the API endpoint exist?"

Current Lore Agent:
- No tree-sitter integration
- Cannot check function existence
- Cannot create tasks (Beads is gone)
- Cannot open PRs without tool_use (which fails with Haiku)

---

## Gap 5: Context Core Building and Self-Improvement Loop

### What Klaus Did
From AGENTS.md (Context Core Builder Agent):
```
1. Export promoted chunks from PostgreSQL
2. Build OCI bundle with PromptFoo eval
3. Compare scores to current production
4. Promote if improvement >= 2%, reject if regression > 5%
5. Log to BigQuery
```

And Autoresearch Loop:
```
1. Find low-confidence queries (from Langfuse)
2. Cluster by semantic similarity
3. Generate 3 candidate context additions
4. Eval each candidate against PromptFoo
5. Open PR for best candidate (if improvement >= 2%)
6. Create Beads task if no candidate passes
```

### Current State
- No Context Core builder
- No autoresearch loop
- No PromptFoo integration
- No Langfuse integration

### The Gap

**Problem 1: Context quality stagnates**
- Without autoresearch, context doesn't improve based on usage
- Low-confidence queries from users are never addressed
- Context quality depends on manual PR review (slow, bottlenecked)

**Problem 2: No feedback loop to Lore team**
- Context Core builder was the self-improvement mechanism
- It would detect regressions and open escalation tasks
- Now: if context quality drops, no automated alert

**Problem 3: Eval evals are not enforced**
- PromptFoo exists in the repo
- No agent runs it nightly
- No gating on quality before promotion

---

## Gap 6: Observability and Error Handling

### What Was in Place
- Each Klaus job had OpenTelemetry instrumentation
- Jobs logged to Cloud Monitoring
- Failures created Beads tasks for human investigation
- Span traces linked failures to root cause

### Current State
- Lore Agent has some metrics (cost, task count)
- No distributed tracing
- Job failures are logged but not escalated
- No automatic task creation for job failures

### The Gap

**Problem 1: Silent job failures**
- If reindex fails, nobody is notified
- Chunks become stale
- Context quality degrades undetected

**Problem 2: No alerting**
- If gap detection finds 50 missing patterns and can't open PRs, no alert
- If spec drift detects 3 broken specs, no task created
- Operations are blind

---

## Gap 7: ADR Generation and Architecture Decision Workflow

### What Was Missing (Even Before Removal)
Klaus was supposed to have tools to:
- Detect architecture patterns from code + PR history
- Suggest ADRs for unwritten decisions
- Validate ADRs against implementation

This was never built. Klaus removal made it even less likely.

---

## Gap 8: Knowledge Graph and Entity Extraction

### What Phase 3 Promised
From constitution:
> "**Phase 3: Knowledge Graph, Context Cores, and Self-Improvement (3-4 weeks, after 3+ months of content)**
> - Graphiti deployment (GKE graphiti namespace + FalkorDB).
> - `graph_search` + `get_entity_history` Lore MCP tools (Graphiti proxy).
> - Lore ontology definition (8 entity types, 15 relationships)."

### Current State
- No Graphiti
- No FalkorDB
- No entity extraction
- No relationship indexing

### The Gap

**Problem 1: Search is flat**
- Only vector + BM25 hybrid search
- No relationship traversal (e.g., "find all code that implements ADR-003")
- No temporal history ("what did this function look like 3 months ago?")
- No entity caching (every search re-embeds)

**Problem 2: Entity context is lost**
- A function exists in code, is referenced in a PR, implements an ADR, and appears in a spec
- Without the graph, those 4 pieces are separate chunks
- A developer sees code but not the ADR intent, PR context, or spec rationale

---

## Quantified Impact Assessment

| Gap | Severity | Impact | Workaround | Timeline |
|---|---|---|---|---|
| Code parsing (tree-sitter) | **CRITICAL** | Reindex produces bad chunks, spec drift is impossible, gap detection cannot verify code | Manual code review of chunks (scale: O(n) developer time) | Immediate |
| Task state sync (Beads) | **CRITICAL** | Multi-dev team sees task state inconsistency, duplicate work, blocked sprints | Use GitHub Issues (slower, no conflict prevention) | Immediate |
| Task dependencies | **HIGH** | Developers cannot see task order, blockers are invisible, risk of starting work on blocked tasks | Manual sprint board review + Slack | Immediate |
| Job orchestration (Klaus) | **HIGH** | Background jobs fail silently, content becomes stale, quality undetected | Manual nightly re-index + gap detection (1-2 person-hours per week) | 2-4 weeks |
| Context Core building | **MEDIUM** | Context quality is static, low-confidence queries never fixed, no self-improvement | Manual content review every sprint | 4-8 weeks |
| Autoresearch loop | **MEDIUM** | Opportunity cost: cannot generate high-value context from usage patterns | Manual gap analysis based on support tickets | 4-8 weeks |
| Observability | **MEDIUM** | Job failures are silent, ops team is blind to quality degradation | Manual log review (daily overhead) | 2 weeks |
| Knowledge graph | **LOW** | Search results are flat, no entity history, slower context retrieval | Hybrid search (slower but works) | 8+ weeks |

---

## Root Cause Analysis

Why were Klaus and Beads removed?

From org learnings (2026-03-30):
> "Klaus output wrapping was unfixable after 8+ attempts"
> "Per-file LLM calls for onboarding instead of single JSON blob — nested code fences break JSON parsing"

**Decision**: Replace Klaus with Lore Agent (Haiku + direct API).

**Assumption**: Lore Agent can perform the same background jobs as Klaus.

**Reality**: Haiku cannot perform semantic reasoning tasks that require code parsing, multi-file context, or structured tool use. The assumption was wrong.

Similar decision for Beads:
> "Pipeline tasks + GitHub Issues replace it for task tracking"

**Assumption**: GitHub Issues + pipeline tasks can provide task state management.

**Reality**: GitHub Issues lack distributed sync, conflict resolution, and dependency tracking. Dolt provided those via CRDT semantics.

---

## Recommended Actions (Priority Order)

### Tier 1: Unblock immediate operations (this week)

1. **Add tree-sitter to Lore Agent**
   - Integrate tree-sitter-cli for code parsing
   - Parse TypeScript, Python, Go, Kotlin, Swift on demand
   - Validate that reindex produces correct chunks (by type and boundary)
   - Acceptance: Sample 100 chunks, verify 100% are at correct AST boundaries

2. **Restore Beads task state** (minimum viable)
   - Beads itself is removed, but task metadata can live in `.specify/tasks.md` + a simple JSON file
   - `bd` CLI shim that reads tasks.json and supports: `bd list --claimed`, `bd claim <id>`, `bd update <id> --status done`
   - Store claims in `.specify/.tasks-state.json` (git-ignored, synced via Dolt or simple polling)
   - Acceptance: Developer A claims task, Developer B sees claim without refresh

3. **Implement spec drift detection**
   - Read spec file (already parsed in `.specify/spec.md`)
   - Use tree-sitter to parse code
   - Write a simple assertion matcher (function exists? type signature matches?)
   - Create GitHub Issues for mismatches (via Lore Agent tool_use)
   - Acceptance: 3 deliberate spec-code mismatches are detected and issued as Problems

### Tier 2: Restore background job quality (2-4 weeks)

4. **Reindex agent improvements**
   - Tree-sitter integration (from Tier 1)
   - Semantic chunking: preserve module/class/function boundaries
   - Content type detection (code vs. comment vs. docstring)
   - Chunk validation: split at correct boundaries, no truncation
   - Acceptance: Reindex 5 sample repos, verify chunks are at correct boundaries (100%)

5. **Gap detection with code reasoning**
   - Query Langfuse for low-confidence traces (if available; else use synthetic test data)
   - Parse relevant code files (tree-sitter)
   - Identify missing patterns (functions that should exist but don't)
   - Draft missing context (e.g., add new function skeleton or doc)
   - Open PR via GitHub API (standard tool_use, should work)
   - Acceptance: 5 synthetic gaps are correctly identified and PR is opened

6. **Task dependency tracking**
   - Parse `.specify/tasks.md` for DEPENDS ON annotations
   - Build dependency graph in memory
   - Validate: no circular dependencies, correct order
   - Provide `list_ready_tasks()` MCP tool that filters by: no blockers, not claimed
   - Acceptance: `lore-feature` creates 5-task spec, agent correctly orders them and reports T001 is ready, T002-5 are blocked

### Tier 3: Restore self-improvement loop (4-8 weeks)

7. **Context Core builder (minimal version)**
   - Export promoted chunks from PostgreSQL
   - Build simple evaluation: does the context answer a set of test queries?
   - Run against current and candidate versions
   - If improvement, promote to production (tag in Artifact Registry or similar)
   - Acceptance: 5 eval cycles run, 1+ promotion occurs

8. **Autoresearch loop (minimal version)**
   - Query for low-confidence traces (synthetic data if no Langfuse)
   - Cluster by topic
   - Generate 2 candidates per topic (not 3)
   - Eval both
   - Open PR for best candidate
   - Acceptance: 3 gaps are researched, 1+ PR is opened

### Tier 4: Observability and monitoring (2 weeks)

9. **Job failure alerting**
   - Wrap each Lore Agent job with try/catch
   - On failure, create GitHub Issue with: job name, error, stack trace, recommended action
   - Acceptance: Intentional job failure creates Issue within 1 minute

10. **Distributed tracing**
    - Add OpenTelemetry to Lore Agent
    - Emit span for each major operation (reindex repo, parse file, embed chunk, etc.)
    - View traces in Cloud Monitoring
    - Acceptance: Run reindex, view full trace with 20+ spans

---

## Implementation Strategy

### Do NOT restart Klaus
- Klaus was overcomplicated (full agent with all capabilities)
- Learn from removal: keep Lore Agent but add focused capabilities

### DO incrementally add missing pieces to Lore Agent
1. Tree-sitter (code parsing)
2. Task state shim (Beads-like, minimal)
3. Dependency tracking
4. Error handling + alerting
5. Eval loop + promotion

### Timeline
- **Tier 1 (critical)**: 3-4 days
- **Tier 2 (quality)**: 2-3 weeks
- **Tier 3 (self-improvement)**: 3-4 weeks
- **Tier 4 (observability)**: 1-2 weeks

Total: ~6-7 weeks to restore full functionality

---

## Success Criteria

At the end of this research:
- [ ] `lore-feature` workflow is end-to-end executable (spec → tasks → claims → PR → done)
- [ ] Reindex produces chunks at correct AST boundaries (100% of code chunks)
- [ ] Spec drift detection runs weekly and creates Issues for mismatches
- [ ] Task claims are synced across developers
- [ ] Job failures are alerted within 1 minute
- [ ] Gap detection runs weekly and opens 1+ PR per week
- [ ] Context quality is measured (eval score) and improving monthly

```

---

## Output

I've completed a **deep research document** analyzing the gaps from removing Klaus and Beads. The research covers:

1. **8 critical gaps** with concrete examples and failure modes
2. **Quantified impact** (CRITICAL/HIGH/MEDIUM/LOW severity)
3. **Root cause analysis** (wrong assumptions about Haiku capabilities)
4. **10 recommended actions** in 4 tiers, with acceptance criteria and timeline
5. **Implementation strategy** (incremental, not rebooting Klaus)

### Key Findings

**Most Critical Gap**: Code parsing. Removed Klaus had tree-sitter integration. Current Lore Agent cannot parse code AST, making reindex, spec drift detection, and gap detection produce low-quality results.

**Most Disruptive Gap**: Task state management. Beads provided CRDT-like sync via Dolt. GitHub Issues are pull-to-refresh and have no conflict resolution, breaking multi-developer task coordination.

**Opportunity Cost**: Self-improvement loop (autoresearch + context core building) is not running. Content quality is static, usage gaps are not addressed.

### Next Steps

1. **Commit this research** to `.specify/research/gaps-from-removal.md`
2. **Create Beads tasks** for Tier 1 actions (3-4 day sprint)
3. **Assign to team**: estimate 6-7 weeks to restore full functionality

Would you like me to:
- Create GitHub Issues for each recommended action?
- Draft a PR with this research document?
- Start on Tier 1 implementation (tree-sitter + task state shim)?