# Feature Specification: Lore — Shared Context Infrastructure

| Field             | Value                |
| ----------------- | -------------------- |
| Feature           | Lore Platform        |
| Branch            | 1-lore-platform      |
| Status            | Shipped              |
| Created           | 2026-03-25           |
| Updated           | 2026-04-20           |
| Owner             | Platform Engineering |
| Phase 0 Target    | 3-4 working days     |
| Full Stack Target | 6-8 weeks            |

Lore is shared context infrastructure for Claude Code: one install command
gives every developer full organizational awareness — conventions, ADRs, team
patterns, PR history, and task state — served automatically from a central
context repository rather than loaded by hand each session.

> **Note (2026-04-13):** This spec has been updated to reflect the shipped
> implementation. Several technology choices changed after the initial spec:
> Beads + Dolt replaced by pipeline tasks in PostgreSQL (ADR-009), the
> purpose-built Lore Agent service deployed as the cluster agent runtime
> (ADR-007), Graphiti/FalkorDB replaced by a PostgreSQL-backed live knowledge
> graph (ADR-010), and OCI Context Cores replaced by DB-cached context
> assembly. All changes are documented in `adrs/`.

> **Note (2026-04-20):** Further updates to reflect ADR-015 (accepted
> 2026-04-17) and post-April-13 implementation work. Key changes: the
> review reactor is now webhook-driven (not cron-polled), prompt caching
> added to all agent LLM calls, per-template context budgets introduced
> (8K default, 16K for research), and additional MCP tools shipped. A
> stuck-task terminal-state recovery mechanism was also added. All changes
> are reflected in FR-13 and the new FR-16 and FR-17 below (the MCP tool
> surface now lives in `specs/mcp-tools/`).

## Problem Statement

Developers at Acme open Claude Code with no organizational context.
They must manually load conventions, architectural decisions, team
patterns, and sprint context every session. This friction means Claude
Code operates as a generic tool rather than an organization-aware
assistant. The result: inconsistent code, rediscovered decisions,
duplicated reasoning, and slower onboarding for new engineers.

## Vision

Every developer opens Claude Code and it already knows: org-wide
conventions, team-specific patterns, active architectural decisions,
PR history and the reasoning behind it, and current sprint context —
without any manual loading. One install command. Everything else
automatic.

## User Personas

**New Developer (Day 1)**

A developer who has just joined Acme. They have no knowledge of org
conventions, team patterns, or architectural history. They need to
become productive without reading hundreds of pages of documentation.

**Active Developer (Daily Use)**

A developer who works in one or more product repos daily. They need
Claude Code to understand their team's conventions, the reasoning
behind past decisions, and their current task state — automatically.

**Tech Lead / Architect**

Reviews PRs, makes architectural decisions, and ensures consistency
across teams. They need the system to capture and distribute decisions
so they are not the bottleneck for "why did we do it this way?"
questions.

**Platform Engineer**

Maintains the Lore infrastructure itself. They need observability
into what context is being served, where gaps exist, and how the
system is performing.

## Background — Usage Scenarios

**Scenario 1 — First-Time Setup**

**Actor:** New Developer

**Flow:**

1. Developer runs a single install command.
2. System clones the context repository, builds the MCP server,
   detects the developer's team, configures Claude Code settings,
   installs platform skills, and runs a health check.
3. Developer opens Claude Code.
4. Claude Code greets them with team context loaded and suggests
   available work.

**Acceptance Criteria:**

- Installation completes in under 5 minutes on macOS and Linux.
- Health check reports all green on a clean machine with standard
  prerequisites (Node.js, Python, Git).
- Re-running the install command produces the same correct state
  with no errors or side effects (idempotent).
- The install command works without pre-cloning the repository.

**Scenario 2 — Morning Orientation**

**Actor:** Active Developer

**Flow:**

1. Developer opens Claude Code.
2. Context and task state sync automatically in the background.
3. Developer asks what to work on.
4. System shows unblocked tasks with priorities.
5. Developer claims a task and begins work.

**Acceptance Criteria:**

- Context sync completes silently without developer action.
- Task list shows only unblocked work.
- Claimed tasks are tracked automatically during the session.
- Claude Code can answer convention questions (e.g., "what are our
  error handling conventions?") without manual context loading.

**Scenario 3 — Starting a New Feature**

**Actor:** Active Developer

**Flow:**

1. Developer invokes the `/lore-feature` skill.
2. System asks what they want to build (one question).
3. System generates a project constitution from real ADRs and team
   conventions, shows it, asks for confirmation.
4. System generates a feature specification, shows it, asks for
   confirmation.
5. System generates a task breakdown, shows it, asks for
   confirmation.
6. System syncs tasks into the pipeline task store.
7. Developer sees their tasks and begins implementation.

**Acceptance Criteria:**

- The full loop completes in under 30 minutes.
- Developer speaks fewer than 10 words total — system does the work,
  developer confirms at decision points.
- Generated constitution reflects real team ADRs and conventions.
- Generated tasks have correct dependency relationships.

**Scenario 4 — Opening a Pull Request**

**Actor:** Active Developer

**Flow:**

1. Developer invokes the `/lore-pr` skill.
2. System reads the current task, spec file, changed files, and
   ADR references automatically.
3. System drafts a complete PR description with all required
   sections filled.
4. Developer reviews and edits the draft.
5. System reminds developer to mark the task as done.

**Acceptance Criteria:**

- PR description includes Why, Alternatives Rejected, ADR References,
  and Spec sections — all populated from existing context.
- Developer does not write the description from scratch.
- If no spec file exists, system asks one targeted question about
  alternatives rejected before finishing the draft.

**Scenario 5 — Context Quality Enforcement**

**Actor:** Any Developer (via CI)

**Flow:**

1. Developer opens a PR that modifies context files (CLAUDE.md, ADRs,
   team conventions).
2. CI runs context evaluation tests against the changes.
3. If the changes contradict established conventions (e.g., suggesting
   float storage for monetary amounts when the ADR requires integers),
   CI fails the PR.

**Acceptance Criteria:**

- CI fails PRs that contradict active ADRs.
- CI fails PRs with empty "Why" or "Alternatives Rejected" sections.
- Warning-only mode for the first 2 weeks, hard fail after.
- Eval pass threshold is 85%.

**Scenario 6 — Semantic Context Search (Phase 1)**

**Actor:** Active Developer

**Flow:**

1. Developer asks Claude Code a question about a specific code
   pattern or decision.
2. System performs hybrid search (vector + keyword) across the
   team's context store.
3. System returns relevant code chunks, PR discussions, and ADRs
   ranked by relevance.

**Acceptance Criteria:**

- Search returns relevant results in under 200ms (p99).
- A query like "ChargeBuilder idempotency" returns both the code
  chunk (matched by vector similarity) and the PR that introduced
  it (matched by keyword).
- Merging a PR with an alternatives-rejected section makes that
  reasoning searchable within 5 minutes.

**Scenario 7 — Cluster Delegation (Phase 1)**

**Actor:** Active Developer

**Flow:**

1. Developer identifies a well-defined task that will take more
   than 20 minutes (e.g., writing integration tests).
2. Developer asks Claude Code to delegate it to the cluster via
   `lore_create_pipeline_task`.
3. System creates a LoreTask CR; the Lore Agent schedules an
   ephemeral K8s Job pod that runs Claude Code with pre-loaded context.
4. Developer continues local work while the Job pod runs independently.
5. Developer checks status with `lore_get_pipeline_status` and retrieves
   results when ready. A GitHub Issue is automatically created and
   updated with task progress.

**Acceptance Criteria:**

- Task submission returns immediately with a tracking ID.
- Agent nodes also get a **live, scoped** Lore MCP for the run's duration:
  the rendered agent recipe carries a `resources.mcp_servers` entry
  (`name: lore`, `transport: http`, `headers_secret: lore-mcp-auth`) and drops
  `lore_create_pipeline_task`, so the pod can search memory/context and record
  targeted memory throughout the run — the only context path, since nothing is
  fetched before the pod starts. A shared `lore-mcp`
  gateway serves those tools over MCP-over-HTTP at a public `:443` host (the
  agent-pod NetworkPolicy allows only public `:443` egress).
- The gateway reads each request body defensively: it JSON-parses the body
  (an empty body carries no payload), caps it at 1 MB (`413` over the cap) so an
  authenticated-but-rogue pod cannot exhaust gateway memory, and returns `400`
  for a malformed body rather than a `500`. ([validated by `http-transport.test.ts:11`](apps/mcp-server/src/transport/http-transport.test.ts#L11), [`http-transport.test.ts:15`](apps/mcp-server/src/transport/http-transport.test.ts#L15), [`http-transport.test.ts:19`](apps/mcp-server/src/transport/http-transport.test.ts#L19), [`http-transport.test.ts:25`](apps/mcp-server/src/transport/http-transport.test.ts#L25))
- When no gateway URL is configured (the default, and every cluster before the
  gateway is deployed), the rendered agent recipes omit the `mcp_servers` block
  entirely — no empty-`url` MCP entry lands in any recipe CRD.
- The gateway also serves an **agent-skills registry** at `/skills` (unauthenticated —
  skills are org conventions, not secrets): `GET /skills/settings.json` returns the org
  session settings/hooks, and `GET /skills/<name>.tar.gz` streams a gzip tarball of the
  baked skill directory, rejecting an unsafe/traversing name with `404`. The
  ai-agent-subsystem init fetches these into a run's `$HOME/.claude` (recipe
  `resources.skills` + `skills_source`, ADR-030). Hooks are per vendor:
  `GET /skills/hooks/<vendor>.tar.gz` streams that vendor's hook bundle laid out
  relative to `$HOME` (`hooks/claude/` carries `.claude/settings.json`, which is also
  the file the flat `settings.json` is served from, so an init that predates bundles
  reads the same hooks), and a vendor with no bundle 404s like an unsafe name. A path only counts as owned on
  `GET /skills/*`; a bare `/skills/<name>` with no `.tar.gz` suffix (and not
  `settings.json`) 404s the same as an unsafe name. ([validated by returns false for a non-skills path so the caller falls through to MCP](apps/mcp-server/src/transport/skills-registry.test.ts#L39), [serves settings.json with the org hooks](apps/mcp-server/src/transport/skills-registry.test.ts#L47), [404s a traversal / unsafe skill name](apps/mcp-server/src/transport/skills-registry.test.ts#L60), [serves a baked skill as a gzip tarball](apps/mcp-server/src/transport/skills-registry.test.ts#L94), [404s a /skills/ path with no recognized suffix](apps/mcp-server/src/transport/skills-registry.test.ts#L71), [returns false for a non-GET method even on a /skills/ path](apps/mcp-server/src/transport/skills-registry.test.ts#L82), [serves hooks/claude.tar.gz laid out relative to HOME, carrying the settings the Bash guard is wired in](apps/mcp-server/src/transport/skills-registry-hooks.test.ts#L36), [serves the flat settings.json from the Claude bundle, so an init that predates bundles reads the same hooks](apps/mcp-server/src/transport/skills-registry-hooks.test.ts#L48), [404s a vendor with no bundle and a traversing vendor name alike](apps/mcp-server/src/transport/skills-registry-hooks.test.ts#L72))
- The `lore-context` skill ships `guard-tests.sh`, a Claude Code `PreToolUse` hook on
  the Bash tool that the org `settings.json` wires at the path the tarball unpacks to.
  It reads the hook event on stdin and exits 2 — the reason on stderr reaches the
  agent — for any test-runner invocation the recipe forbids: under the default
  `scoped` policy a bare suite run (`npm test`, `vitest run` with no path,
  `go test ./...`, bare `pytest`) is refused, a runner naming test files, a workspace
  package, a Go package path or a `cd` into a subdirectory passes, and commands that
  are not test runners are never touched; under `none` every runner, dependency
  install and build is refused; under `any` the guard stands down, as it does for an
  event carrying no command. The command is judged one segment at a time, quotes
  count as whitespace and a runner reached through a shell wrapper or a direct
  `node_modules` binary is still a runner, so a comment, a neighbouring command, an
  `--exclude` or a watch flag cannot vouch for a bare run, while a `cd` into any
  subdirectory (relative, quoted or absolute), a directory argument, a Cargo package
  or a Go sub-tree counts as scope. The hook wiring in the Claude bundle exits 0 when
  the script is absent and no policy is declared, and blocks every Bash call when a
  policy is declared but the script is gone. The policy rides each recipe as
  `test_policy` in its shipped file's frontmatter, is carried on the definition's config, where it
  is the one key that inherits across the project, org and yaml layers (a row that
  sets config for another reason keeps the recipe's guard), and the CR renderer
  renders it as the `LORE_TEST_POLICY` env entry (an unrecognised value renders
  nothing rather than switching the guard off); the read-only review recipes
  (`review`, `code-review`, `code-review-recheck`, `code-review-refine`, `pr-ready`)
  declare `none`. *(amended 2026-09-25)* Under `none` the guard also refuses a linter,
  formatter or typechecker — CI publishes that verdict and reaching one through `npx`
  downloads it into a 1Gi pod, which is how a review pod fetched eslint mid-review — and
  it names `lore_get_ci_failures` as where to read the verdict instead; the `scoped`
  policy an implementation pod runs is unchanged. The same guard reaches a Gemini pod
  through its own vendor bundle, whose `BeforeTool` hook on `run_shell_command` wraps the
  script and reports a refusal the way gemini-cli reads one, as a `block` decision on
  stdout rather than an exit code. ([validated by is wired as the Bash PreToolUse hook in the settings every pod fetches, at the path the lore-context tarball unpacks to](apps/mcp-server/src/transport/guard-tests.test.ts#L61), [validated by](apps/mcp-server/src/transport/guard-tests.test.ts#L274), [validated by](apps/mcp-server/src/transport/guard-tests.test.ts#L284), [validated by](apps/mcp-server/src/transport/guard-tests.test.ts#L290), [validated by](apps/mcp-server/src/transport/guard-tests.test.ts#L294), [validated by](apps/mcp-server/src/transport/guard-tests.test.ts#L317), [validated by](apps/mcp-server/src/transport/skills-registry-hooks.test.ts#L60), [refuses a bare suite run with the reason the agent needs](apps/mcp-server/src/transport/guard-tests.test.ts#L91), [refuses every unscoped runner spelling under the default policy](apps/mcp-server/src/transport/guard-tests.test.ts#L100), [lets a runner through when it names files, a workspace, a Go package or a subdirectory](apps/mcp-server/src/transport/guard-tests.test.ts#L150), [ignores commands that are not test runners, installs included, under the default policy](apps/mcp-server/src/transport/guard-tests.test.ts#L174), [refuses named tests, installs and builds alike under policy none](apps/mcp-server/src/transport/guard-tests.test.ts#L189), [stands down under policy any and on an event with no command](apps/mcp-server/src/transport/guard-tests.test.ts#L214), [counts a dot-relative subdirectory as scoped but never the repo root, whether spelled `.`, `./` or absolute](apps/mcp-server/src/transport/guard-tests.test.ts#L224), [sees through a shell wrapper, a quoted command and a direct node_modules binary](apps/mcp-server/src/transport/guard-tests.test.ts#L121), [refuses a runner whose scope is only vouched for by a comment, a neighbouring command, an --exclude or a watch flag](apps/mcp-server/src/transport/guard-tests.test.ts#L136), [blocks every Bash call when the recipe declares a policy but the guard script is gone, and stands down when none was declared](apps/mcp-server/src/transport/guard-tests.test.ts#L239), [inherits config.test_policy from the layer below when a row sets config for another reason, so a review recipe stays at none](libs/shared/src/outbound/project/agents/agent-defs-port.test.ts#L61), [maps a declared policy onto the LORE_TEST_POLICY env the pod's guard reads, and an unknown one onto nothing](libs/shared/src/domain/task-types/test-policy.test.ts#L5), [declares none on every read-only review recipe, so a review pod cannot run tests, installs or builds at all](libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts#L236), [lists general and review sorted by name, review carrying test_policy none on config](libs/shared/src/outbound/project/agents/agent-defs-files.test.ts#L46))
- *(added 2026-10-07)* The guard is the only refusal an agent pod meets: no floor pipeline's agent declares `disallowed_tools`, which Claude would enforce in every permission mode, and every agent names `${LORE_SKILLS_URL}` as its skills source, since without it the floor serves its own `/skills` and the pod never receives the guard. ([validated by fetch their hooks and test guard from Lore's skills registry, never the floor's own](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1728), [validated by deny no tool, leaving the test guard as the only refusal](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L1736))
- The gateway's top-level router tries `/healthz`, then `/skills/*`, before
  falling through to `/mcp`: a non-`/mcp` path 404s, an `/mcp` request missing
  the configured bearer token 401s, and on `/mcp` itself POST mints or resumes
  a session (400 without a valid session on a non-initialize body) while
  GET/DELETE require an already-minted session id (400 otherwise) and any
  other method 405s. ([validated by `answers /healthz without touching /mcp or /skills routing`](apps/mcp-server/src/transport/http-transport.test.ts#L51), [`falls through to the skills registry for a /skills path`](apps/mcp-server/src/transport/http-transport.test.ts#L61), [`404s a path that is neither /healthz, /skills, nor /mcp`](apps/mcp-server/src/transport/http-transport.test.ts#L71), [`401s an /mcp request missing the configured bearer token`](apps/mcp-server/src/transport/http-transport.test.ts#L80), [`400s a POST /mcp with no session and a non-initialize body`](apps/mcp-server/src/transport/http-transport.test.ts#L90), [`400s a GET /mcp with an unknown session id`](apps/mcp-server/src/transport/http-transport.test.ts#L105), [`405s an unsupported method on /mcp`](apps/mcp-server/src/transport/http-transport.test.ts#L118))
- Developer can check task status and retrieve results without
  leaving Claude Code.
- The pipeline task is visible in the shared task tracker — no
  duplicate work. ([validated by renders the heading and offers no way to create a task](apps/web-ui/src/app/assembly-runs/AssemblyRunListView.test.tsx#L15))
- Watcher posts the PR link and any Slack notifications on completion.

**Scenario 8 — Automated Gap Detection (Phase 2)**

**Actor:** Platform Engineer (reviewer), System (initiator)

**Flow:**

1. Weekly job analyzes low-confidence context retrievals from the
   past week.
2. System clusters gaps by topic similarity.
3. For each gap cluster with 3+ occurrences, system drafts the
   missing content (CLAUDE.md addition, ADR, or runbook).
4. System opens a PR to the context repo with the draft, assigned
   to the relevant team.
5. Team reviews and merges or closes with feedback.

**Acceptance Criteria:**

- Gap detection identifies recurring low-confidence queries.
- Drafted content is specific and actionable (not just "add
  information about X").
- PRs are labelled and assigned to the correct team.
- Human review is required before any drafted content enters the
  shared context store.

**Scenario 9 — Temporal Knowledge Graph Traversal (Phase 3)**

**Actor:** Active Developer or Tech Lead

**Flow:**

1. Developer asks "why does the auth service work this way?"
2. System queries the live knowledge graph to traverse relationships:
   code → PR → ADR → Spec, including entity relationships and
   confidence-annotated facts.
3. System presents the chain of reasoning across sources.

**Acceptance Criteria:**

- `lore_query_graph` returns multi-hop traversal results that vector
  search alone cannot answer.
- Graph entities carry typed relationships (OWNS, CALLS, IMPLEMENTS,
  SUPERSEDES, REFERENCES, AUTHORED_BY, DEFINES, etc.).
- Facts include confidence annotations (`verified`, `observed`,
  `inferred`, `stale`) and temporal validity.
- Conflicting facts are surfaced with a `[CONFLICT]` prefix.

## Functional Requirements

### FR-1: Context Repository

The system MUST maintain a single repository (`re-cinq/lore`) that
serves as the source of truth for organizational context.

- FR-1.1: Root `CLAUDE.md` with architecture contracts, code
  conventions, and key service descriptions (under 2 pages).
- FR-1.2: Per-team `CLAUDE.md` files under `teams/<team>/` (max
  1-2 pages each).
- FR-1.3: ADRs in MADR format with required YAML frontmatter
  (adr_number, title, status, date, deciders, domains, supersedes,
  superseded_by, related_prs).
- FR-1.4: Runbooks with required frontmatter (service, incident_type,
  severity, trigger, last_incident, last_updated).
- FR-1.5: CODEOWNERS file enforcing ownership boundaries.
- FR-1.6: Three-level CLAUDE.md hierarchy where more specific wins
  on conflicts (org > repo > team).

### FR-3: Developer Onboarding

The system MUST provide a single-command install experience. ([validated by `install-contract.test.mjs:13`](scripts/install-contract.test.mjs#L13))

- FR-3.1: Install script clones the context repo, builds the MCP
  server, detects team, configures Claude Code settings, installs
  platform skills, and runs health checks. ([validated by `install-contract.test.mjs:13`](scripts/install-contract.test.mjs#L13), [`install-contract.test.mjs:52`](scripts/install-contract.test.mjs#L52), [`install-contract.test.mjs:68`](scripts/install-contract.test.mjs#L68), [`install-contract.test.mjs:81`](scripts/install-contract.test.mjs#L81), [`install-contract.test.mjs:94`](scripts/install-contract.test.mjs#L94), [`install-contract.test.mjs:102`](scripts/install-contract.test.mjs#L102), [`install-contract.test.mjs:141`](scripts/install-contract.test.mjs#L141))
- FR-3.2: Install script is idempotent — re-running always produces
  correct state. ([validated by `install-contract.test.mjs:120`](scripts/install-contract.test.mjs#L120), [`install-contract.test.mjs:120`](scripts/install-contract.test.mjs#L120), [`install-contract.test.mjs:154`](scripts/install-contract.test.mjs#L154))
- FR-3.3: Install script works without pre-cloning the repository. ([validated by `install-contract.test.mjs:26`](scripts/install-contract.test.mjs#L26), [`install-contract.test.mjs:39`](scripts/install-contract.test.mjs#L39))
- FR-3.4: Settings merge (via helper script) appends platform hooks
  without overwriting personal developer hooks. ([validated by `lore-merge-settings.test.mjs:25`](scripts/lore-merge-settings.test.mjs#L25), [`lore-merge-settings.test.mjs:41`](scripts/lore-merge-settings.test.mjs#L41))
- Decision: the `lore-doctor` health-check script tests all connections and
  prints clear pass/fail with fix instructions for each.

### FR-4: Task Tracking Integration

The system MUST provide agent-native task tracking via PostgreSQL
pipeline tasks and GitHub Issues. ([validated by `task-queue.test.ts:20`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L20))

- Decision: the generated `AGENTS.md` instructs Claude Code on task-tracking
  commands and proactive guidance behaviour.
- Decision: a SessionStart hook syncs task state automatically.
- Decision: a Stop (session-end) hook reminds about open claimed tasks.
- FR-4.4: *(rewritten 2026-10-07)* There is no `lore_sync_tasks` tool and no tasks.md
  parser. The tool, `POST /api/spec-tasks/sync`, `parseTasks`,
  `inferPhaseDependencies` and `specSlugFromBranch` existed to turn a feature's
  tasks.md into spec-task rows for the spec-task executor, which is removed
  (`specs/external-floor` FR15.0); the `[DEPENDS ON: ...]` and `[P]` markers they
  read are now consumed only as prose, in the `Depends on #<n>` lines the `issues`
  station writes into each task issue. A plan's tasks reach the implementation loop
  as tickets (`specs/7-feature-planning` FR-11.13), one at a time per repository. ([validated by registers no spec-task tool, since a plan's tasks are implemented from the backlog](apps/mcp-server/src/transport/tools/pipeline-tools.test.ts#L160), [validated by refuses a spec-task at trust level %s, pointing at the backlog loop](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L163))
- FR-4.5: Concurrent task claiming uses `SELECT ... FOR UPDATE SKIP
LOCKED` — atomically prevents duplicate work without versioning
  overhead. A claim attempt on a taken task returns an immediate
  error; the developer or agent reads the ready list and picks
  another task. ([validated by `task-queue.test.ts:7`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L7))
- FR-4.6: Every pipeline task automatically creates a GitHub Issue
  on the target repo (labelled `lore-managed`). The issue receives
  status comments and is closed when the PR is created. ([validated by `issues.test.ts:102`](libs/shared/src/outbound/project/issues/issues.test.ts#L107), [`issues.test.ts:111`](libs/shared/src/outbound/project/issues/issues.test.ts#L120))
- FR-4.7: Optional approval gates: tasks can require a human to add
  an `approved` label on the GitHub Issue before processing.
  Configured via the settings UI or `lore.settings` table. ([validated by `SettingsView.test.tsx:123`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L125))
### FR-5: Spec-Driven Feature Workflow

- FR-5.2: `/lore-pr` skill drafts PR descriptions from spec, task
  context, and changed files. ([validated by `pr-body.test.ts:5`](libs/shared/src/domain/pr-body.test.ts#L5), [`pr-body.test.ts:11`](libs/shared/src/domain/pr-body.test.ts#L11))
- Decision: constitution generation (the `lore-gen-constitution` glue script)
  calls `lore_assemble_context` to populate `.specify/constitution.md` with
  real ADRs and team conventions.

#### Rationale

The platform's skills carry a feature end to end: `/lore-feature` guides the full
loop — constitution generation → specification → task breakdown → pipeline task
wiring — while Claude Code does the mechanical work and the developer confirms
only at decision points (constitution review, spec review, task breakdown review).

### FR-6: PR Quality Enforcement

The system MUST enforce PR description quality from day one. ([validated by `pr-section-check.test.ts:26`](libs/shared/src/work/pr-section-check.test.ts#L26), [`pr-section-check.test.ts:30`](libs/shared/src/work/pr-section-check.test.ts#L30))

- FR-6.1: PR template with required sections: Why, What Changed,
  Alternatives Considered, ADRs & Architecture, and Testing. ([validated by `pr-template.test.ts:11`](libs/shared/src/pr-template.test.ts#L11), [`pr-template.test.ts:15`](libs/shared/src/pr-template.test.ts#L15), [`pr-template.test.ts:19`](libs/shared/src/pr-template.test.ts#L19), [`pr-template.test.ts:23`](libs/shared/src/pr-template.test.ts#L23), [`pr-template.test.ts:27`](libs/shared/src/pr-template.test.ts#L27), [`pr-template.test.ts:31`](libs/shared/src/pr-template.test.ts#L31))
- FR-6.2: CI check fails PRs with an empty Why or Alternatives Considered
  section. ([validated by `pr-section-check.test.ts:34`](libs/shared/src/work/pr-section-check.test.ts#L34), [`pr-section-check.test.ts:44`](libs/shared/src/work/pr-section-check.test.ts#L44), [`pr-section-check.test.ts:55`](libs/shared/src/work/pr-section-check.test.ts#L55), [`pr-section-check.test.ts:67`](libs/shared/src/work/pr-section-check.test.ts#L67), [`pr-section-check.test.ts:78`](libs/shared/src/work/pr-section-check.test.ts#L78), [`pr-section-check.test.ts:92`](libs/shared/src/work/pr-section-check.test.ts#L92), [`pr-section-check.test.ts:101`](libs/shared/src/work/pr-section-check.test.ts#L101), [`pr-section-check.test.ts:107`](libs/shared/src/work/pr-section-check.test.ts#L107), [`pr-section-check.test.ts:111`](libs/shared/src/work/pr-section-check.test.ts#L111))
- Decision: PR-quality enforcement starts in warning-only mode; the platform
  team flips it to hard-fail via a configuration flag in the CI workflow —
  there is no automatic date-based cutoff.

### FR-7: Ingestion Pipeline (Phase 1)

The system MUST ingest content from multiple sources into the vector
store via the Lore Agent service. ([validated by `content-classify.test.ts:5`](libs/shared/src/domain/content-classify.test.ts#L5))

- FR-7.1: Fast path: on-push to main triggers incremental ingestion
  via pipeline task. ([validated by `ingest-workflow.test.ts:22`](libs/shared/src/work/ingest-workflow.test.ts#L22))
- Decision: the nightly full re-index was retired on 2026-09-08 (ADR-019 amendment) and the job runner that could dispatch one went with Lore's own Floor on 2026-10-02; merge-time CI ingest is the only ingestion path, so a file no merge has touched since onboarding stays unindexed until one does
- FR-7.3: Content types: code (AST-split), pull requests (diff +
  description + comments), ADRs, docs (section-chunked), specs,
  runbooks. ([validated by `chunker.test.ts:6`](libs/shared/src/work/chunker.test.ts#L6), [`chunker.test.ts:172`](libs/shared/src/work/chunker.test.ts#L172), [`content-classify.test.ts:11`](libs/shared/src/domain/content-classify.test.ts#L11))
- FR-7.4: Secret and credential redaction runs at ingest time via
  `redactSecrets()`; matched secrets are stripped before content is
  embedded and made searchable. ([validated by `redact.test.ts:5`](libs/shared/src/lib/redact.test.ts#L5), [`redact.test.ts:30`](libs/shared/src/lib/redact.test.ts#L30))

### FR-8: Observability (Phase 1)

The system MUST provide observability into context retrieval quality. ([validated by `otel.test.ts:6`](libs/server-core/src/outbound/otel.test.ts#L6), [`usage-tools.test.ts:44`](apps/mcp-server/src/transport/tools/usage-tools.test.ts#L44))

- Decision: all MCP retrieval calls are traced via OpenTelemetry spans
  exported to Cloud Monitoring (SDK-level instrumentation).
- FR-8.2: Low-confidence retrievals (score < threshold) tagged as
  gap candidates via OTEL span attributes and Cloud Monitoring
  custom metrics. ([validated by `otel.test.ts:6`](libs/server-core/src/outbound/otel.test.ts#L6), [`otel.test.ts:10`](libs/server-core/src/outbound/otel.test.ts#L10), [`otel.test.ts:14`](libs/server-core/src/outbound/otel.test.ts#L14))
- See ADR-010 for the autoresearch loop that consumed the low-confidence
  gap signal: it was deleted with Lore's own Floor on 2026-10-02, and the
  signal itself is still recorded.
- FR-8.4: `lore_my_usage` tool exposes per-developer token consumption
  (today / 7-day / 30-day) without leaving Claude Code. ([validated by `usage-tools.test.ts:44`](apps/mcp-server/src/transport/tools/usage-tools.test.ts#L44), [`usage-pg.test.ts:144`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L173))

### FR-9: Context Evaluation (Phase 1)

The system MUST validate context quality from CI.

- See `specs/context-evals` for the rules: a nightly GitHub Actions job has
  lore-api write a question from each sampled ADR and spec, assemble the
  context an agent would get, and judge the answer (#2443). The PromptFoo
  suites per team, their 85%-to-merge gate on pull requests and the nightly
  `eval_runner` and `context_core_builder` jobs it replaced are gone: the
  jobs went with Lore's own Floor on 2026-10-02, and migration 0101 dropped
  `pipeline.eval_runs` and `pipeline.context_core_history`.

### FR-10: Gap Detection (Phase 2)

- See ADR-010: the weekly autoresearch job that analyzed the previous
  week's low-confidence retrievals was deleted with Lore's own Floor.
- Decision: candidate gaps are clustered by embedding similarity.
- Decision: the agent opens PRs to the context repo with the drafted content,
  assigned to the relevant team.
- Decision: human review is required before any auto-drafted content is merged.
 
- FR-10.10 *(added 2026-09-28)*: The `gap-fill` draft is a delivering recipe: it
  commits and pushes what it wrote, because the validate and push nodes after it
  are other pods with fresh clones, and a draft that finds the context already
  current reports `changes_requested` naming the file or commit that already
  does the work, lifted into the row's `failure_detail` as `already current: …`,
  so the run ends without a pull request instead of validating an empty branch. The `gap-fill` recipe did not say push after its line moved to a pod per node (nor did the `general` recipe, deleted with its line on 2026-10-01), so 17 of 36 gap-fill branches carried zero commits (2026-08-15 to
  2026-09-25): validate diffed nothing, ran the checks unscoped over the whole
  tree, and was OOM-killed in its 1Gi pod, or passed and the push found nothing,
  so no PR could open. ([validated by lets a draft that finds the context already current report changes_requested, so a true no-op ends the run without a PR instead of failing an empty branch](libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts#L630), [validated by counts gap-fill as delivering, since validate and push after it are other pods (17 of 36 gap-fill branches shipped 0 commits between 2026-08-15 and 2026-09-25)](libs/shared/src/domain/task-types/delivering-recipes.test.ts#L13))

### FR-11: Live Knowledge Graph (Phase 1+)

The system MUST support traversable knowledge via a PostgreSQL-backed
live knowledge graph. ([validated by `graph.test.ts:47`](libs/server-core/src/work/memory/graph.test.ts#L5))

- FR-11.1: Knowledge graph stored in `memory.entities` and
  `memory.edges` tables in PostgreSQL. Updated incrementally on
  every `lore_write_episode` call via the Lore Agent fact extractor. ([validated by `graph.test.ts:133`](libs/server-core/src/work/memory/graph.test.ts#L91))
- FR-11.2: Entity types: Service, Team, Function, PR, ADR, Spec,
  Concept, Runbook. Typed relationships: OWNS, CALLS, IMPLEMENTS,
  SUPERSEDES, REFERENCES, AUTHORED_BY, DEFINES. ([validated by `graph.test.ts:47`](libs/server-core/src/work/memory/graph.test.ts#L5), [`graph.test.ts:73`](libs/server-core/src/work/memory/graph.test.ts#L73))
- FR-11.3: `lore_query_graph(query)` MCP tool traverses the live graph
  for multi-hop relationship results. ([validated by `memory-tools.test.ts:50`](apps/mcp-server/src/transport/tools/memory-tools.test.ts#L50))
- FR-11.4: Facts carry temporal validity (`valid_from`/`valid_to`),
  confidence tiers (`verified` / `observed` / `inferred` / `stale`),
  and retrieval metadata (`retrieval_count`, `last_retrieved_at`,
  `half_life_days`). ([validated by `facts.test.ts:96`](libs/server-core/src/work/memory/facts.test.ts#L71), [`memory-ranking.test.ts:225`](libs/shared/src/domain/memory-ranking.test.ts#L251))
- FR-11.5: Contradiction detection: when a new fact has cosine
  similarity ≥ 0.92 to an existing one, the old fact is invalidated
  and a conflict record written to `memory.fact_conflicts`. Context
  assembly prefixes `[CONFLICT]` on facts with recent (7-day)
  conflicts. ([validated by `facts.test.ts:96`](libs/server-core/src/work/memory/facts.test.ts#L71), [`facts.test.ts:104`](libs/server-core/src/work/memory/facts.test.ts#L104))

### FR-12: Intelligent Memory Lifecycle (Phase 1)

The system MUST manage agent memory automatically without agent
cooperation. ([validated by `session-tracker.test.ts:193`](libs/server-core/src/outbound/session-tracker.test.ts#L123))

- FR-12.1: MCP server tracks all tool calls in a 500-entry ring
  buffer (`session-tracker.ts`). On exit, dumps to
  `~/.lore/last-session.json`. Stop hook POSTs to
  `/api/session-summary` for automatic episode + fact extraction. ([validated by `session-tracker.test.ts:193`](libs/server-core/src/outbound/session-tracker.test.ts#L123), [`session-tracker.test.ts:15`](libs/server-core/src/outbound/session-tracker.test.ts#L15))
- FR-12.2: Daily job at 5 AM scores memories 0-10 using half-life
  decay (`strength = 0.5^(age / half_life_days)`). Evicts
  lowest-scoring memories when agent exceeds 500 entries. Cleans
  invalidated facts older than 30 days beyond the 2000 cap. ([validated by `memory-ranking.test.ts:206`](libs/shared/src/domain/memory-ranking.test.ts#L232))
- FR-12.3: Daily job at 5:30 AM groups recent facts (7-day lookback)
  by repo and calls Haiku to extract 1-3 higher-level patterns per
  repo. Stored as `consolidated/{repo}/{timestamp}` memories.
  Minimum 5 facts required to trigger consolidation. ([validated by `memory-lifecycle.test.ts:99`](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L108), [`memory-lifecycle.test.ts:198`](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L207))
- FR-12.4: Every `lore_search_memory` call asynchronously increments
  `retrieval_count`, updates `last_retrieved_at`, and extends
  `half_life_days` (+2, cap 365) on returned facts. Stale facts
  revive to `observed` on retrieval. Fire-and-forget — adds zero
  latency to search. ([validated by `memory-lifecycle.test.ts:214`](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L223), [`memory-lifecycle.test.ts:188`](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L197))
- FR-12.5: After every pipeline task completion (PR, no-changes,
  failure), an episode is automatically written. For high-signal
  events (PRs, failures), Haiku extracts a lesson and stores it
  as `auto-curation/{ref}` memory. ([validated by `episode-writer.test.ts:89`](libs/shared/src/work/episode-writer.test.ts#L89))

### FR-13: Autonomous Review Loop (Phase 1, opt-in)

The system MUST support an opt-in, webhook-driven autonomous review loop per
repo with a safety-net cron (ADR-015; the review agent runs on the
ai-agent-subsystem per ADR-031). ([validated by starts code-review when a pull request opens in a repository with auto_review on](apps/stations/src/events/floor-review-handlers.test.ts#L92), [validated by asks the floor nothing when auto_review is off](apps/stations/src/events/floor-review-handlers.test.ts#L100))

- FR-13.1: After an implementation PR is created, an auto-review is started on
  the ai-agent-subsystem when `auto_review` is enabled on the repo (ADR-031
  retired the loretask-watcher). ([validated by `auto-review-enabled.test.ts:5`](libs/shared/src/work/review/auto-review-enabled.test.ts#L5), [[starts code-review when a pull request opens in a repository with auto_review on](apps/stations/src/events/floor-review-handlers.test.ts#L92), [starts code-review for a pull request no review has run on](libs/shared/src/work/review/floor-review-start.test.ts#L284))
- FR-13.2: The review agent reads spec + conventions and the `post-review`
  station posts ONE formal PR review — inline comments per finding plus a summary, carrying the verdict as its
  GitHub review event (`APPROVE` / `REQUEST_CHANGES`, always on, no longer a neutral comment). ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding](apps/stations/src/code-review/post-review/post-review.test.ts#L94), [validated by submits an APPROVE review carrying the inline findings for an approved verdict](apps/stations/src/code-review/post-review/post-review.test.ts#L250))
- FR-13.3: On a formal `APPROVE` the PR becomes eligible for (auto-)merge once the
  remaining gates pass; auto-merge reads the bot's latest review, so a later push's re-check verdict supersedes the earlier one. ([validated by posts a visible APPROVE review for a bare REVIEW_RESULT:APPROVED with no findings block](apps/stations/src/code-review/post-review/post-review.test.ts#L282))
- FR-13.4: When changes are requested, a follow-up round is started on the same
  branch carrying the feedback (the code-review-reply path). ([validated by starts code-review-reply for review 99 with the repository, the pull request and the review, and no intent: the agent reads what each comment asks](libs/shared/src/work/review/floor-review-start.test.ts#L456), [validated by starts code-review-reply for a MEMBER's request-changes review 99](apps/stations/src/events/floor-review-handlers.test.ts#L157))
- FR-13.5: *(Restated 2026-10-01.)* Nothing files a `needs-human-help` Issue any more: the escalation line that did was deleted (#2330) having never run in production. Where the implementation loop owns the pull request, review threads left unresolved park its ticket with a comment that names why; elsewhere a person reads the review on the pull request. ([validated by labels issue 7 blocked and comments when await-pr ended on unresolved threads](apps/stations/src/code-review/run-settled/loop-closed.test.ts#L279), [validated by labels lore:blocked and comments when await-pr resumed failed](libs/shared/src/work/backlog/loop-run-closed.test.ts#L299))
- FR-13.6: The primary trigger is GitHub webhooks (ADR-015): the stations
  service turns qualifying `pull_request`, `pull_request_review`, and PR
  `issue_comment` events into calls that start or reply on a code-review
  pipeline of the external floor (`apps/stations/src/events/floor-review-handlers.ts`);
  bot-authored events are skipped as a loop guard. ([validated by starts code-review when a pull request opens in a repository with auto_review on](apps/stations/src/events/floor-review-handlers.test.ts#L92), [validated by starts nothing when the lore bot comments @lore review](apps/stations/src/events/floor-review-handlers.test.ts#L146), [validated by starts no reply for a review the lore bot submitted](libs/shared/src/work/review/floor-review-start.test.ts#L474))
- FR-13.7: **Safety-net cron** fires at `7 7-17 * * 1-5` (UTC,
  Mon-Fri) to catch dropped webhook deliveries. Cron-triggered runs
  are gated by `isBusinessHours()` (default: Europe/Berlin, 09:00-18:00
  Mon-Fri via `LORE_BUSINESS_HOURS_{TZ,START,END,DAYS}` env vars).
  Webhook-triggered runs are never gated by business hours. ([validated by `business-hours.test.ts:37`](libs/shared/src/lib/business-hours.test.ts#L37))
- Decision: the webhook trigger degrades gracefully when its ingress env is
  absent — a warning is logged and the safety-net cron (FR-13.7) covers the gap.

### FR-14: Spec Drift Detection (Phase 2)

The system MUST detect when specifications diverge from implementation. ([validated by `chunks.test.ts:203`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L204), [`chunks.test.ts:225`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L226))

- FR-14.1: *(Since 2026-10-02.)* A weekly line reads each spec's statements from the traceability graph and
  finds those whose bound test fails. It is the `spec-upkeep` line on the external floor (`specs/external-floor` FR14); the per-repo `spec-drift` fan-out on Lore's own Floor that did this before is gone. ([validated by finds the statement of specs/cart/spec.md whose bound test fails, with its section and the test](libs/shared/src/work/spec-upkeep/findings.test.ts#L65))
- Decision: divergence above 20% of a spec's assertions triggers a `gap-fill`
  pipeline task for the owning team.
- FR-14.3: Test files and generated files are excluded. ([validated by `chunks.test.ts:681`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L713), [`chunks.test.ts:714`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L746))
- FR-14.4: Spec-drift reads a repo's spec chunks and code symbols from
  the repo's resolved schema (team schema when provisioned, `org_shared`
  otherwise) — the same schema the reindex job wrote them to. The
  `codeSymbols` read excludes `symbol_type = 'call'` chunks, so a test
  file's `describe` title can never satisfy the drift heuristic's
  known-symbol check for a deleted declaration.
  ([validated by `chunks.test.ts:166`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L167), [`chunks.test.ts:184`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L185), [`chunks.test.ts:203`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L204), [`chunks.test.ts:225`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L226), [`chunks.test.ts:681`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L713), [`chunks.test.ts:714`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L746))

### FR-15: Progressive Trust (Phase 1)

The system MUST gate task types per-repo based on demonstrated
reliability. ([validated by `pipeline-tasks.trust.test.ts:33`](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L33))

- FR-15.1: *(rewritten 2026-10-07)* `settings.trust.level` controls which task types are
  allowed: `docs` (gap-fill/runbook/onboard + feature-planning
  per ADR-027), `tests` (+review),
  `implementation` (+implementation-loop/feature-request),
  `full` (all). `onboard` is allowed at every tier — it produces a
  docs-only scaffolding PR and duplicate protection lives in its own
  route's guard, not the trust ladder. `spec-task` is in no tier: it was listed at
  `implementation` and `full` from 2026-09-29, and the type is refused outright now
  that nothing runs one, so trust is never consulted for it.
  ([validated by `allows an onboard task at trust level %s`](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L33), [validated by refuses an implementation-loop task at trust level docs](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L48), [validated by refuses a spec-task at trust level %s, pointing at the backlog loop](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L163))
- FR-15.2: Trust auto-promotes after 3 successful merges at the current level
  (overridable per repo via `auto_promote_threshold`), climbing
  `docs → tests → implementation → full` and resetting the merge counter on
  each promotion. A repo already at `full`, or carrying no level at all, is
  left untouched rather than banking a counter with nothing to spend it on.
  The default level is `implementation` for backward compatibility. An
  unrecognised level demotes to the lowest rung rather than throwing or
  inventing an out-of-range index. ([validated by `trust-ladder.test.ts:5`](apps/stations/src/work/lib/trust-ladder.test.ts#L5), [`trust-ladder.test.ts:14`](apps/stations/src/work/lib/trust-ladder.test.ts#L14), [`trust-ladder.test.ts:23`](apps/stations/src/work/lib/trust-ladder.test.ts#L23), [`trust-ladder.test.ts:38`](apps/stations/src/work/lib/trust-ladder.test.ts#L38), [`trust-ladder.test.ts:47`](apps/stations/src/work/lib/trust-ladder.test.ts#L47), [`trust-ladder.test.ts:65`](apps/stations/src/work/lib/trust-ladder.test.ts#L65), [`demotes to the lowest rung rather than inventing an index for an unrecognised level`](apps/stations/src/work/lib/trust-ladder.test.ts#L56))

### FR-16: Prompt Caching on Agent LLM Calls (Phase 1)

The system MUST cache repeated LLM prefixes on all agent-side Anthropic
API calls to reduce token cost (ADR-015, added 2026-04-17). ([validated by `prompt-cache.test.ts:87`](libs/shared/src/outbound/llm/prompt-cache.test.ts#L87))

- FR-16.1: `libs/shared/src/outbound/llm/anthropic-provider.ts` places two cache
  breakpoints per request — one on the system prompt block
  (`buildCacheableSystem`), one on the tool schema block
  (`buildCacheableTools`) — so a tool-schema edit cannot bust the system
  cache and vice versa. ([validated by `anthropic-provider.test.ts:9`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L9), [`anthropic-provider.test.ts:32`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L32), [`anthropic-provider.test.ts:48`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L48))
- FR-16.2: `getCacheControl(jobName)` from `agent/src/lib/prompt-cache.ts`
  returns `{type: "ephemeral", ttl: "1h"}` for jobs in the
  `LORE_CACHE_1H_JOBS` allowlist and `{type: "ephemeral"}` (5-min)
  otherwise. Default allowlist: `auto-curation`, `review_reactor`,
  `fact-extraction`, `graph-extraction`. Special values: `none`
  disables 1h everywhere; `*` enables it for every job. ([validated by `prompt-cache.test.ts:87`](libs/shared/src/outbound/llm/prompt-cache.test.ts#L87), [`anthropic-provider.test.ts:21`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L21))
- Decision: cache eligibility is latched at module load to prevent
  mid-process toggles from busting the server-side cache.
- FR-16.4: Each call computes a djb2 hash of the system + tools prefix
  and compares to the last call for the same `jobName`. Log line
  emits: `cache hit | first-call | break:system | break:tools |
break:ttl(Nm)`. ([validated by `prompt-cache.test.ts:117`](libs/shared/src/outbound/llm/prompt-cache.test.ts#L117), [`prompt-cache.test.ts:123`](libs/shared/src/outbound/llm/prompt-cache.test.ts#L123))
- FR-16.5: `response.usage.cache_creation_input_tokens` and
  `cache_read_input_tokens` feed cost accounting (1.25× writes,
  0.1× reads). ([validated by `anthropic-provider.test.ts:74`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L74), [`anthropic-provider.test.ts:101`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L101), [`anthropic-provider.test.ts:128`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L128))
- Decision: MCP-server raw fetch call sites (fact extraction, graph
  extraction) have static prefixes below Haiku's 2048-token cache
  minimum — caching is not applied there.
- FR-16.6: `computeCost(model, ...)` prices a call at that model's own
  per-1M-token rate rather than a single flat rate, so a Sonnet or Opus
  call is not silently billed at Haiku's price; an unrecognized model
  falls back to the Haiku-tier rate rather than throwing. Every model
  offered in the agent-definitions `KNOWN_MODELS` picker has its own
  `MODEL_PRICING` entry, so none of them silently falls back. ([validated by `anthropic-provider.test.ts:139`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L139), [`anthropic-provider.test.ts:158`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L158), [`anthropic-provider.test.ts:177`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L177))

### FR-17: Per-Template Context Budgets (Phase 1)

The system MUST apply different token budgets per context-assembly
template to avoid over-sending context on constrained flows.
Added 2026-04-17 per ADR-015.

- FR-17.1: Default `assembleContext` budget: 8K tokens (down from 16K).
  Research template keeps 16K (memory-heavy queries need it).
  Implementation and review templates cap at 8K.
- FR-17.2: The `lore_assemble_context` MCP tool's `max_tokens` parameter
  default is 8K. Callers may pass a higher value explicitly.
- FR-17.3: Template-level budgets are declared in the YAML template
  files under `mcp-server/templates/`.

### FR-18: Stuck-Task Terminal-State Recovery (Phase 1)

The system MUST detect and surface pipeline tasks that are stuck in
non-terminal states and resolve them without manual intervention. ([validated by `task-queue.test.ts:342`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L239))

- FR-18.1: A `stale_task_check` job runs hourly at `:17` and flags
  tasks in `running` or `pending` state for longer than their
  configured timeout plus a grace period. ([validated by `task-queue.test.ts:342`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L239))
- FR-18.2: Stuck tasks are transitioned to a terminal state
  (`failed` with reason `timeout_exceeded`) so the pipeline does not
  stall waiting for a pod that has already exited. ([validated by `task-queue.test.ts:342`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L239))
- FR-18.3: The transition is idempotent — if a task completes between
  detection and the state write, the write is a no-op. ([validated by `task-store-pg.test.ts:68`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L68))
- FR-18.4: A failure episode is written for each stuck task so the
  auto-curation pipeline can surface patterns (e.g. a task type that
  consistently times out). ([validated by `episode-writer.test.ts:89`](libs/shared/src/work/episode-writer.test.ts#L89), [`episode-writer.test.ts:13`](libs/shared/src/work/episode-writer.test.ts#L13))

### FR-19: Task Detail UI (Phase 1)

_(Rewritten 2026-10-05.)_ A task has no page of its own: the run detail
page at `/assembly-runs/[id]` is where a task is read, and the
`/tasks/[id]` lifecycle shell, which only forwarded to a run Postgres
held and so opened empty for a task whose run is on the external floor,
is deleted. ([validated by links to no task page](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L76))

- FR-19.1: `/assembly-runs/<id>` given a task id redirects to the task's
  newest run, so every link that knows only a task (a repository's recent
  tasks, the backlog's onboarding banner, the bounce after a cancel) points
  there. lore-api's `GET /api/assembly-runs?task_id=` answers the run from
  Postgres when it holds one and from the external floor otherwise. ([validated by returns the floor's run for a task Postgres holds no run of](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L187))
- FR-19.2: A task nothing ran for says so: the heading "This task has no
  run", its sentence-cased status badge, its failure reason when it has
  one, and a link to its repository. ([validated by says the failed task has no run and why it failed](apps/web-ui/src/app/assembly-runs/[id]/TaskWithoutRun.test.tsx#L9), [validated by links the task's repository](apps/web-ui/src/app/assembly-runs/[id]/TaskWithoutRun.test.tsx#L23), [validated by shows no reason for a task that has none](apps/web-ui/src/app/assembly-runs/[id]/TaskWithoutRun.test.tsx#L32))
- FR-19.4: The run header offers "Cancel Task" while the run is open and
  has a task, and not on a finished run or a run with no task; the
  confirm-gated `CancelTaskButton` shows only its trigger until clicked,
  then reveals a form posting to `/api/tasks/<id>/cancel` that "Keep
  task" backs out of. There is no "Run Now": no task is created pending. ([validated by offers to cancel the task of a running run](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L57), [validated by offers no cancel on %s](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L67), [`CancelTaskButton.test.tsx:7`](apps/web-ui/src/app/assembly-runs/[id]/CancelTaskButton.test.tsx#L7), [`CancelTaskButton.test.tsx:17`](apps/web-ui/src/app/assembly-runs/[id]/CancelTaskButton.test.tsx#L17), [`CancelTaskButton.test.tsx:30`](apps/web-ui/src/app/assembly-runs/[id]/CancelTaskButton.test.tsx#L30))
- FR-19.6: _(Restated 2026-09-09.)_ The run detail page renders the task's status transitions inside the selected node's transcript rather than as a separate Event Timeline card: each transition that fell inside that node's visits reads as a `· task From → To` system line in the conversation, with its metadata folded behind the line and the from-status omitted on the first transition; a run with no backing task shows the note that no status history is available. ([validated by `transcript-entries.test.ts:116`](apps/web-ui/src/lib/transcript-entries.test.ts#L117), [`transcript-entries.test.ts:141`](apps/web-ui/src/lib/transcript-entries.test.ts#L142), [`TranscriptView.test.tsx:56`](apps/web-ui/src/app/assembly-runs/[id]/TranscriptView.test.tsx#L56), [adds a task transition the stream reports to the selected node's transcript](apps/web-ui/src/app/assembly-runs/[id]/RunLiveShell.test.tsx#L162))
- FR-19.7: The run detail page renders the task's LLM-call table: one
  row per call with the model, `input / output` token counts, duration,
  and a status badge (red with the error text on failure), and an
  empty-state note in place of the table when there are none; the section
  is a collapsible card titled LLM Calls. ([validated by `LlmCallsTable.test.tsx:25`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L25), [`LlmCallsTable.test.tsx:33`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L33), [`LlmCallsTable.test.tsx:41`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L41), [`LlmCallsTable.test.tsx:19`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L19), [`LlmCallsTable.test.tsx:53`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L53), [`LlmCallsTable.test.tsx:65`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L65))
- FR-19.16: The two task transitions the UI offers are shared seams in
  `libs/shared`, not route-local SQL. `escalateTask` (run-now) refuses an
  unknown id and anything past `pending`, sets `priority = 'immediate'`,
  and records the transition carrying the priority it replaced.
  `cancelTask` treats `completed`, `merged`, `failed` and `cancelled` as
  terminal — `completed` was missing, so the web UI's own guard refused
  a click the API accepted. ([validated by `sets priority immediate on a pending task`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L20), [`pipeline-tasks.escalate.test.ts:34`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L34), [`pipeline-tasks.escalate.test.ts:51`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L51), [`pipeline-tasks.escalate.test.ts:59`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L59), [`pipeline-tasks.escalate.test.ts:69`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L69), [`pipeline-tasks.escalate.test.ts:80`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L80))

- FR-19.17: lore-api serves one `lore.repos` row at
  `GET /api/repos/{owner}/{repo}` under the `read` scope, reading it
  through the Project facade for the repo in the path, 404 for a repo
  with no row and 500 for a failed lookup. It returns the record WHOLE
  rather than a per-caller projection: nine web-ui call sites across
  five files each selected a different column subset of this row, and
  projecting per caller would move that duplication into the API
  instead of removing it. ([validated by `repo-record.test.ts:66`](apps/lore-api/src/transport/routes/repos/repo-record.test.ts#L66), [`repo-record.test.ts:75`](apps/lore-api/src/transport/routes/repos/repo-record.test.ts#L75), [`repo-record.test.ts:83`](apps/lore-api/src/transport/routes/repos/repo-record.test.ts#L83), [`repo-record.test.ts:92`](apps/lore-api/src/transport/routes/repos/repo-record.test.ts#L92))
- FR-19.18: `SettingsPort.record(repo)` is that read — the whole row or
  null — implemented by the Pg adapter against `lore.repos` and by the
  in-memory double over its seeded rows, so a caller that needs more
  than `rawSettings` or `team` has one place to get it. ([validated by returns the seeded row as the camelCase model](libs/shared/src/outbound/project/settings/settings-record.test.ts#L44), [`settings-record.test.ts:55`](libs/shared/src/outbound/project/settings/settings-record.test.ts#L55), [`settings-record.test.ts:71`](libs/shared/src/outbound/project/settings/settings-record.test.ts#L71), [`settings-record.test.ts:89`](libs/shared/src/outbound/project/settings/settings-record.test.ts#L89), [`settings-record.test.ts:101`](libs/shared/src/outbound/project/settings/settings-record.test.ts#L101))

- FR-19.19: lore-api serves the run views' four reads under the `read`
  scope — `GET /api/assembly-lines` (filterable by status, repo, or a
  `task_id` that answers the newest attempt first, default limit 50),
  `GET /api/assembly-lines/{id}`, `.../nodes` in visit order, and
  `.../token-usage`, which sums the four usage scalars across the run's
  turns SQL-side. The SQL moved verbatim from web-ui, LATERAL cost
  fallback included: a run whose `llm_calls` predate per-line
  attribution still costs what its task cost. Every read degrades to
  empty — a 404 for the by-id one — rather than 500 on a database
  predating the tables, because a run view is additive and a page must
  not go down over an unmigrated cluster. Token usage reads
  `pipeline.agent_run_turns`, not `llm_calls`: the cost table is
  authoritative but a row lands only when a run ENDS, which is the
  moment the card showing the number disappears. ([validated by `assembly-lines.test.ts:86`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L87), [`assembly-lines.test.ts:90`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L91), [`assembly-lines.test.ts:106`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L107), [`assembly-lines.test.ts:153`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L154), [`assembly-lines.test.ts:169`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L170), [`assembly-lines.test.ts:223`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L243), [`assembly-lines.test.ts:397`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L496), [`assembly-lines.test.ts:410`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L509), [`assembly-lines.test.ts:418`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L517), [`assembly-lines.test.ts:430`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L529), [`assembly-lines.test.ts:223`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L243), [`assembly-lines.test.ts:490`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L589), [`assembly-lines.test.ts:508`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L607), [`assembly-lines.test.ts:518`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L617))

- FR-19.20: lore-api serves the activity reads the audit, gaps, events,
  job-run and repo-overview views need, all under the `read` scope:
  `GET /api/memory-audit` (agent / operation filters plus a
  `zero_results` lens for the gap view, answering a page AND the unpaged
  total the pager needs), `GET /api/events` (repo-scoped, newest first,
  repo required), `GET /api/job-runs/{id}`, and
  `GET /api/repos/{owner}/{repo}/activity-counts` (7-day tasks,
  auto-merges and escalations). A count the database cannot answer is
  NULL, never zero: an unmigrated cluster must not render as "nothing
  happened", and no dashboard figure may take its page down. ([validated by `activity.test.ts:31`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L31), [`activity.test.ts:35`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L35), [`activity.test.ts:49`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L49), [`activity.test.ts:60`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L60), [`activity.test.ts:70`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L70), [`activity.test.ts:83`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L83), [`activity.test.ts:111`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L111), [`activity.test.ts:115`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L115), [`activity.test.ts:129`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L129), [`activity.test.ts:142`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L142), [`activity.test.ts:152`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L152), [`activity.test.ts:165`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L162))
- The `status` an event shows on the repo page is the Floor's DELIVERY of
  it, read from `pipeline.event_deliveries`, and an event no subscriber
  ever received reads `undelivered` — `pipeline.events` itself carries no
  status (ADR-044 amendment 2026-09-09). ([validated by `activity.test.ts:94`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L94))

- FR-19.21: lore-api serves the memory browse reads under the `read`
  scope — `GET /api/graph-browse` (counts, type breakdown, entity list,
  and the selected entity's edges), `GET /api/pools` and
  `GET /api/pools/{name}`, `GET /api/episodes`, `GET /api/memories`
  and `GET /api/memory-search`. Shaped per SCREEN, not per table: the
  graph explorer renders four reads at once, and four endpoints would
  cost four round trips for a page that is the only caller of each.
  Edges are read ONLY when an entity is selected — the explorer's most
  expensive query must not run on every page view — and invalidated ones
  stay hidden unless asked for. `/api/memories` returns each memory with
  its version history and facts, skipping the fact read for a memory
  whose `has_facts` says it has none; the page it replaced fanned out up
  to 201 round trips for one screen. `/api/memory-search` is LEXICAL
  (ts_rank over raw text), the search page's question — the embedding
  search remains `POST /api/memory`. ([validated by `memory-browse.test.ts:31`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L31), [`memory-browse.test.ts:35`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L35), [`memory-browse.test.ts:51`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L51), [`memory-browse.test.ts:64`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L64), [`memory-browse.test.ts:78`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L78), [`memory-browse.test.ts:91`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L91), [`memory-browse.test.ts:106`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L106), [`memory-browse.test.ts:117`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L117), [`memory-browse.test.ts:130`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L130), [`memory-browse.test.ts:140`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L140), [`memory-browse.test.ts:153`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L153), [`memory-browse.test.ts:164`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L164), [`memory-browse.test.ts:179`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L179), [`memory-browse.test.ts:189`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L189), [`memory-browse.test.ts:218`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L218), [`memory-browse.test.ts:195`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L195), [`memory-browse.test.ts:230`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L230))

- FR-19.22: lore-api serves the task-shaped dashboard reads under the
  `read` scope — `GET /api/repo-tasks` (a repo's most recent, empty on a
  database with no `pipeline.tasks`), `GET /api/task-stats` (org totals),
  `GET /api/agent-activity` (per-agent task counts and spend, org-wide or
  repo-scoped), `GET /api/tasks/{id}/runtime` (its transitions and LLM
  calls) and `GET /api/audit-log` (a repo's entries, filtered to the
  decision types the caller renders). Agent activity FULL OUTER JOINs the
  task agents with the memory agents: an agent that only ever wrote
  memories — a developer's local MCP — appears in no task row, and
  dropping it would hide exactly the agents a human recognises. The
  aggregates stay SQL-side because the alternative is shipping the whole
  pipeline history to Node for one dashboard row per agent. ([validated by [`task-views.test.ts:31`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L31), [`task-views.test.ts:37`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L37), [`task-views.test.ts:48`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L48), [`task-views.test.ts:52`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L52), [`task-views.test.ts:66`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L66), [`task-views.test.ts:79`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L79), [`task-views.test.ts:90`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L90), [`task-views.test.ts:102`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L102), [`task-views.test.ts:117`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L117), [`task-views.test.ts:135`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L135))

- FR-19.23: lore-api serves the two spend/analytics screens whole —
  `GET /api/analytics/spend-window` (the interval-scoped spend screen,
  FR-19f — the old month-to-date `GET /api/spend` merged into it) and
  `GET /api/analytics-overview` (six reads). Spend draws on BOTH cost
  sources deliberately: `pipeline.anthropic_cost_daily` is Anthropic's
  authoritative billed figure, but its buckets close at UTC midnight and
  the in-progress day is never emitted, so the billed total ends at the
  last SYNCED day — yesterday when the daily sync is current, earlier
  when it ran late or failed — and `pipeline.llm_calls` — token-exact
  against the hourly report, available with no admin key — is what brings
  it current for every day after `MAX(bucket_date)`, however many that
  is. Assuming that gap was always exactly one day is what let whole
  days of spend fall into neither figure. The
  billed reads degrade to empty on a cluster without the table, and
  availability is decided by the `as_of` STAMP rather than a row count:
  only the stamp separates "synced, nothing owed" from "never synced",
  and the view hides the section for the second instead of showing a
  confident zero. ([validated by [`spend.test.ts:30`](apps/lore-api/src/transport/routes/analytics/spend.test.ts#L30), [`spend.test.ts:34`](apps/lore-api/src/transport/routes/analytics/spend.test.ts#L34), [`spend.test.ts:46`](apps/lore-api/src/transport/routes/analytics/spend.test.ts#L46), [`spend-window.test.ts:145`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L196), [`spend-window.test.ts:339`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L384), [`spend-window.test.ts:360`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L405), [`spend-window.test.ts:378`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L423))

- FR-19.24: *(Rewritten 2026-10-02.)* A task is not revised by queueing another task. `POST /api/task` with `action: "revise"` answers `409` and points at a review that requests changes on the pull request, which the `code-review-reply` line answers there. The `reviseTask` seam that queued a follow-up feature-request task on the parent's branch is deleted with the last task type it ran as (`specs/external-floor` FR16.7). ([validated by queues no revision of task t1 and points at a review on its pull request](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L175))

- FR-19.25: lore-api serves the org-wide `lore.settings` under the
  `admin` scope — `GET /api/settings` (the entries plus the repo count
  the settings page shows) and `PUT /api/settings`, whose writable keys
  are an ALLOWLIST: that table holds the ingest token and the approval
  config, so a route upserting any key a caller named would let one
  invent settings the platform then reads. A blank value leaves the
  stored one alone rather than erasing it, because the form posts every
  field and an untouched secret arrives empty.
  `GET /api/repos/{owner}/{repo}/sessions` answers how many
  developers have run a local session against a repo. ([validated by [`org-settings.test.ts:44`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L44), [`org-settings.test.ts:50`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L50), [`org-settings.test.ts:69`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L69), [`org-settings.test.ts:69`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L69), [`org-settings.test.ts:85`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L85), [`org-settings.test.ts:109`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L148), [`org-settings.test.ts:109`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L148), [`org-settings.test.ts:69`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L69), [`org-settings.test.ts:85`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L85), [`org-settings.test.ts:99`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L138), [`org-settings.test.ts:109`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L148), [`org-settings.test.ts:120`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L159), [`repos.test.ts:107`](apps/web-ui/src/lib/api/repos.test.ts#L107), [`repos.test.ts:117`](apps/web-ui/src/lib/api/repos.test.ts#L117))

- FR-19.26: lore-api serves the context browser's chunk reads —
  `GET /api/chunks` (ranked, org-wide or repo-scoped, one row past the
  page size so a caller detects a further page without a COUNT),
  `GET /api/chunk-types`, `GET /api/chunks/by-path`, and
  `GET /api/repos/{owner}/{repo}/chunk-summary`. Chunks live in per-team
  schemas plus `org_shared`, so a global read is a UNION ALL across every
  PROVISIONED schema: the catalog is the source of truth, not
  `lore.repos.team`, which is free text and can name a schema nobody ever
  created — unioning that would fail every chunk read, and dropping a real
  one would silently show a page missing another team's chunks. The chip
  set is deliberately unfiltered by the active type so a chip never
  disappears the moment it is selected. Moving this read, and the union
  builder with it, is what let web-ui stop holding a Postgres pool at all.
  ([validated by [`chunks-browse.test.ts:55`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L55), [`chunks-browse.test.ts:59`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L59), [`chunks-browse.test.ts:76`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L76), [`chunks-browse.test.ts:88`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L88), [`chunks-browse.test.ts:101`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L101), [`chunks-browse.test.ts:115`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L115), [`chunks-browse.test.ts:129`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L129), [`chunks-browse.test.ts:153`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L153), [`chunks-browse.test.ts:181`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L181), [`chunks-browse.test.ts:203`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L203), [`chunks-browse.test.ts:234`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L234), [`chunks-browse.test.ts:234`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L234))

- FR-19.27: Retired 2026-09-09. The operator-recorded Anthropic credit
  balance is gone: `POST /api/spend/credits` no longer exists and
  `GET /api/analytics/spend-window` carries no `budget` block, so the spend
  screen reads nothing a person typed in. Anthropic's Admin API still exposes
  no credit balance, so what is LEFT stays unfetchable by construction — the
  page reports what was spent, not what remains. The `pipeline.credit_ledger`
  table (migration 0045) is dropped by migration 0080. ([validated by carries no budget block and never reads a credit ledger](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L341))

- FR-19.28: Retired 2026-09-09 with FR-19.27. `/spend` renders no balance
  section, credits card, or top-up form, and with them went the page's one
  em dash placeholder: every figure left is Lore-computed or vendor-billed, so
  the page is complete on Lore data alone. ([validated by carries no balance section, credits card or top-up form](apps/web-ui/src/app/spend/SpendView.test.tsx#L196), [`SpendView.test.tsx:338`](apps/web-ui/src/app/spend/SpendView.test.tsx#L337))

- FR-19.29: `/spend` attributes Lore-computed spend to the execution
  cluster that ran each call, so a satellite cluster's burn is legible
  apart from the home cluster's — the question Anthropic's own billing
  cannot answer, since its cost report groups only by workspace and the
  org runs a single one. A call reaches its cluster through the station
  run it belongs to (`llm_calls.station_run_id` →
  `station_runs.cluster_agent_id` → `cluster_agents.name`), joined with
  OUTER joins so a direct-API call with no station run keeps its spend
  under one `(central / regular)` bucket rather than being dropped, and
  read through the same degrade-to-empty guard the billed figures use so
  a deployment predating the station and cluster-agent tables renders
  nothing instead of 500-ing the whole page. The table always renders — an empty
  window shows an empty-state row rather than a blank table.
  ([validated by [`spend-window.test.ts:145`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L196), [`spend-window.test.ts:413`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L458), [`SpendView.test.tsx:461`](apps/web-ui/src/app/spend/SpendView.test.tsx#L460), [`SpendView.test.tsx:451`](apps/web-ui/src/app/spend/SpendView.test.tsx#L450), [`spend-window.test.ts:427`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L472)])

- **FR-19f — Interval-scoped spend, with the Kubernetes half** _(added
  2026-09-02)_. The spend page carries a date-interval selector — presets
  (today / 7 days / 30 days / month-to-date) plus free date bounds — and
  `GET /api/analytics/spend-window?from&to` serves the WHOLE page for the
  selected window _(merged 2026-09-03: the old month-to-date `/api/spend`
  sections became interval-scoped and moved into this response, and the
  route was deleted)_: the metered LLM spend (realtime — the agent-events
  sink writes cost rows within seconds of each model call) with its
  by-assembly-line, by-repo, by-model, by-kind, daily, by-task-type and
  by-cluster breakdowns, the interval-scoped Anthropic billed figures with
  their unbilled remainder, plus the Kubernetes compute ESTIMATE: interval pod-hours from `station_runs`
  (rows that named an Agent CR were pods; a run's size is not recorded, so
  hours are priced at a named default profile), which says what it assumed
  _(2026-10-02: the second half of the estimate, the pods running RIGHT NOW
  priced from their ACTUAL resource requests and read through the central
  cluster-agent, was removed with Lore's own cluster agent, along with the
  response's `live_pods` and `live_usd_per_hour`)_. Bad intervals are a 400
  naming the rule (YYYY-MM-DD, from ≤ to, at most 92 days); a
  station-run row with no `finished_at` is capped at two hours from its
  start, never billed as still running — a stale row riding `now()` once
  claimed 8,606 pod-hours for pods that ran minutes; rates
  are env-overridable and echoed in the response so the UI labels the
  number as the estimate it is — Google's invoice lags a day and stays the
  truth.
  ([validated by windows the metered llm spend and prices pod-hours at the assumed profile](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L165), [`spend-window.test.ts:294`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L351), [caps a never-finished station-run row at 2 hours](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L371), [carries every interval-scoped breakdown the merged spend page renders](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L196), [`spend-window.test.ts:245`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L326), [`SpendView.test.tsx:213`](apps/web-ui/src/app/spend/SpendView.test.tsx#L225), [`SpendView.test.tsx:221`](apps/web-ui/src/app/spend/SpendView.test.tsx#L230), [`compute-cost.test.ts:12`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L12), [`compute-cost.test.ts:25`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L25), [`compute-cost.test.ts:34`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L34), [`compute-cost.test.ts:40`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L40), [`compute-cost.test.ts:47`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L47), [`compute-cost.test.ts:56`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L56), [`compute-cost.test.ts:65`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L65), [`compute-cost.test.ts:75`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L75), [`compute-cost.test.ts:82`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L82), [`compute-cost.test.ts:89`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L89), [fetches the default 7-day window and renders the whole spend view from it](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L102), [`SpendWindowPanel.test.tsx:125`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L125), [`SpendWindowPanel.test.tsx:140`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L140), [`SpendWindowPanel.test.tsx:156`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L156), [`SpendWindowPanel.test.tsx:177`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L177), [`spend-window-presets.test.ts:7`](apps/web-ui/src/app/spend/spend-window-presets.test.ts#L7), [`spend-window-presets.test.ts:14`](apps/web-ui/src/app/spend/spend-window-presets.test.ts#L14), [`spend-window-presets.test.ts:25`](apps/web-ui/src/app/spend/spend-window-presets.test.ts#L25), [`spend-window-presets.test.ts:34`](apps/web-ui/src/app/spend/spend-window-presets.test.ts#L34), [`SpendWindowPanel.test.tsx:193`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L193)])

- **FR-19g — Whose invoice, and what a run costs** _(added 2026-09-03)_.
  `pipeline.llm_calls` prices every model call Lore sees, whoever bills it, so
  the page separates them. Metered spend is reported per VENDOR (folded from
  the by-model rollup through the shared `modelVendor` classifier, dearest
  first), and only the Anthropic slice is measured against Anthropic's invoice:
  the review family moved to Gemini on 2026-09-02, and counting that as unbilled
  Anthropic spend under the billed card reported money Anthropic never charged,
  since that remainder is compared against an Anthropic figure. The
  classification is one declaration: the unbilled-remainder query passes the
  shared `NON_ANTHROPIC_LIKE_PATTERNS` straight to `NOT LIKE ALL`, and an
  unrecognized model reads as Anthropic, which over-counts the remainder rather
  than hiding spend already made. The
  by-assembly-line table also carries cost PER RUN, the figure that says whether
  a model or prompt change paid off — a total hides it behind however many runs
  the interval happened to contain.
  ([validated by [`spend-window.test.ts:398`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L443), [`vendor-split.test.ts:5`](apps/lore-api/src/work/analytics/vendor-split.test.ts#L5), [`vendor-split.test.ts:19`](apps/lore-api/src/work/analytics/vendor-split.test.ts#L19), [`vendor-split.test.ts:25`](apps/lore-api/src/work/analytics/vendor-split.test.ts#L25), [`model-vendor.test.ts:5`](libs/shared/src/outbound/llm/model-vendor.test.ts#L5), [`model-vendor.test.ts:17`](libs/shared/src/outbound/llm/model-vendor.test.ts#L17), [`model-vendor.test.ts:21`](libs/shared/src/outbound/llm/model-vendor.test.ts#L21), [`model-vendor.test.ts:11`](libs/shared/src/outbound/llm/model-vendor.test.ts#L11), [`model-vendor.test.ts:25`](libs/shared/src/outbound/llm/model-vendor.test.ts#L25), [`model-vendor.test.ts:31`](libs/shared/src/outbound/llm/model-vendor.test.ts#L31), [`SpendView.test.tsx:473`](apps/web-ui/src/app/spend/SpendView.test.tsx#L472), [`SpendView.test.tsx:480`](apps/web-ui/src/app/spend/SpendView.test.tsx#L479), [`SpendView.test.tsx:493`](apps/web-ui/src/app/spend/SpendView.test.tsx#L492))

- **FR-19h — Reading the spend page at a glance** _(added 2026-09-09)_.
  The page groups its figures into three labelled bands — Lore-computed LLM
  spend, vendor invoices, and Kubernetes compute — each carrying an
  estimate-or-billed pill, so the distinction the page turns on is stated once
  per group rather than left to the prose under each table. The vendor-invoices
  band appears only once a vendor's export has synced, on the same reasoning
  that governs the billed cards. Above the breakdowns, an estimate-versus-billed
  bar pairs what Lore metered against what each synced vendor actually charged —
  the Anthropic slice of the metered spend, never the all-vendor total, since
  other vendors bill their own account — zero when the vendor split names no
  Anthropic row, falling back to the metered total only when there is no split — and, read off the same cluster
  attribution, a Billing Source split of the metered spend — the org's own
  API key (no cluster) versus satellite subscriptions (a named cluster) — so a
  reader can see how much of the total the Anthropic invoice can even account
  for, since a subscription run bills a person's own account and never reaches
  it. The deeper LLM cuts — by model, kind, day, repo, task type and
  cluster — fold behind a disclosure, so the page opens on the two figures that
  answer the money question, cost per line and per vendor, rather than a wall of
  tables. The bar geometry is pure and scale-free: both widths are fractions
  of the larger of the pair, a pair with no spend renders flat rather than
  dividing by zero, and a comparison with no billed side is not drawn at all.
  ([validated by [groups the page into labelled estimate and billed sections](apps/web-ui/src/app/spend/SpendView.test.tsx#L507), [`SpendView.test.tsx:522`](apps/web-ui/src/app/spend/SpendView.test.tsx#L533), [`SpendView.test.tsx:530`](apps/web-ui/src/app/spend/SpendView.test.tsx#L541), [`SpendView.test.tsx:537`](apps/web-ui/src/app/spend/SpendView.test.tsx#L548), [folds the deeper LLM breakdowns behind a disclosure](apps/web-ui/src/app/spend/SpendView.test.tsx#L554), [labels an estimate section with an estimate pill](apps/web-ui/src/app/spend/SpendSection.test.tsx#L7), [`SpendSection.test.tsx:25`](apps/web-ui/src/app/spend/SpendSection.test.tsx#L25), [`SpendSection.test.tsx:36`](apps/web-ui/src/app/spend/SpendSection.test.tsx#L36), [shows the label and both figures for a comparable pair](apps/web-ui/src/app/spend/SpendCompareBars.test.tsx#L15), [`SpendCompareBars.test.tsx:23`](apps/web-ui/src/app/spend/SpendCompareBars.test.tsx#L23), [`SpendCompareBars.test.tsx:29`](apps/web-ui/src/app/spend/SpendCompareBars.test.tsx#L29), [`SpendCompareBars.test.tsx:39`](apps/web-ui/src/app/spend/SpendCompareBars.test.tsx#L39), [scales both values to the larger of the two](apps/web-ui/src/app/spend/spend-chart-geometry.test.ts#L5), [`spend-chart-geometry.test.ts:12`](apps/web-ui/src/app/spend/spend-chart-geometry.test.ts#L12), [takes the Anthropic vendor row when the split names one](apps/web-ui/src/app/spend/SpendView.test.tsx#L570), [is zero when the split names other vendors but no Anthropic](apps/web-ui/src/app/spend/SpendView.test.tsx#L584), [`SpendView.test.tsx:581`](apps/web-ui/src/app/spend/SpendView.test.tsx#L592), [counts the no-cluster bucket as the org API key](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L16), [`SpendBillingSource.test.tsx:23`](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L23), [`SpendBillingSource.test.tsx:30`](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L30), [shows the org API-key row with its cost](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L43), [`SpendBillingSource.test.tsx:50`](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L50), [`SpendBillingSource.test.tsx:57`](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L57), [`SpendBillingSource.test.tsx:65`](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L65)])

- **FR-19i — What a unit of work costs** _(added 2026-09-22, #2116)_.
  `GET /api/analytics/spend-window` also answers what one ticket, one PR's
  reviews and one node visit cost over the selected window, read from
  `pipeline.llm_calls` because it prices the Gemini runs the agent
  transcripts do not. A ticket is the task's `issue_url`, else the
  `issue-<n>` its `implementation-loop` branch names (the same Issue URL, so
  the two merge), else the description older runs carry — the task's, or
  the run's own `args.description` when it has no task — and it sums
  every run of the ticket; the tickets carry their count, total, average and
  median (computed in SQL with `percentile_cont`), plus the five dearest and
  five cheapest, each linked to its Issue. ([validated by sums 4 tickets to 8.25 USD with a 1 USD median, keyed by issue url, loop branch, then description](apps/lore-api/src/integration-tests/spend-unit-costs.test.ts#L68), [carries what a ticket, a PR review and a node visit cost, lore issue 1648 dearest at 70.27 USD](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L259))

- **FR-19i.1** A PR review is keyed by repo plus `args.pr_number` and covers every
  `code-review`, `code-review-recheck` and `code-review-reply` run of that
  PR; the reviews carry the same ranked summary per PR, linked to the pull
  request, the average per run of each of the three lines, and their cost
  by model. ([validated by puts review, recheck and reply of PR 7 on one 1.50 USD PR beside PR 8 at 0.40 USD](apps/lore-api/src/integration-tests/spend-unit-costs.test.ts#L119))

- **FR-19i.2** Per node, each assembly line's nodes carry their visits (one
  `station_runs` row each, reached through `llm_calls.station_run_id`),
  total, cost per visit and the models that ran them. ([validated by counts tdd-round as 2 visits at 2 USD each on two models, per assembly line](apps/lore-api/src/integration-tests/spend-unit-costs.test.ts#L175))

- **FR-19i.3** The metered totals carry the window's prompt-cache reads and writes
  (FR5.1d of the dark-factory spec) beside the uncached input, since a
  Claude run reads most of its input from the cache. ([validated by totals 10 calls' 9000 cache-read and 400 cache-write tokens](apps/lore-api/src/integration-tests/spend-unit-costs.test.ts#L196), [carries 9000000 cache-read and 250000 cache-write tokens beside the metered totals](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L250))

- **FR-19i.4** `/spend` renders the unit costs in their own "Cost per unit
  of work" band, pilled as an estimate since they are summed from the same
  metered calls: the ticket and PR summaries (count, total, average,
  median), the five dearest and five cheapest of each linked to its Issue or
  pull request — a ticket known only by its description is named without a
  link — the review cost per line and per model, and the per-node table with
  visits, total, cost per visit and models. Each table says so when the
  window holds nothing for it. The headline cards carry the cache-read and
  cache-write token totals beside the input and output tokens. ([validated by shows 71 tickets at 872 USD total, 12.28 average and 5.99 median](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L94), [links the dearest ticket lore 1648 to its issue](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L102), [names a ticket known only by its description without a link](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L115), [shows the review line averages: 1.18 per review, 0.19 per recheck](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L126), [links the dearest PR bowman-ui 127 to its pull request](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L135), [lists review cost by model, gemini-3.1-pro-preview at 39.20](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L148), [shows tdd-round at 10 visits, 1.40 per visit, on its two models](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L156), [says so when the window holds no tickets, reviews or node visits](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L164), [gives the cost per ticket, PR review and node its own estimate section](apps/web-ui/src/app/spend/SpendView.test.tsx#L521), [headlines 4200000 cache-read and 180000 cache-write tokens beside the input tokens](apps/web-ui/src/app/spend/SpendView.test.tsx#L214))

### FR-20: Project Facade Ports (Phase 1)

The `Project` facade (ADR-024) exposes every data capability — tasks,
events, chunks, features, agents, workspace, PRs, issues, cost/usage
accounting — through repo-bound ports with a Postgres/GCS/HTTP adapter
and an in-memory double per port, so Floor, mcp-server, and lore-api
share one persistence surface instead of inline SQL. ([validated by `task-queue.test.ts:20`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L20))

- FR-20.1: The `TaskQueue` port drives org-wide claim/sweep: it claims
  one runnable pending task (immediate-first, past the minute interval,
  without the dead `running-local` predicate) or null, CAS-updates a
  still-pending row to a claimer (default or caller-supplied) and returns
  false when already claimed, stays org-wide with no params but scopes to
  a repo when given, flips a running task to completed (reporting
  same-spec dependents it unblocks, false for unknown/non-running), and
  exposes `awaitingApproval`, `distinctTargetRepos`, `prInfo`, and
  `findRecoverable`. ([validated by `task-queue.test.ts:20`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L20), [`task-queue.test.ts:27`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L27), [`task-queue.test.ts:35`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L42), [`task-queue.test.ts:49`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L56), [`task-queue.test.ts:180`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L56), [`task-queue.test.ts:191`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L67), [`task-queue.test.ts:204`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L80), [`task-queue.test.ts:218`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L94), [`task-queue.test.ts:272`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L148), [`task-queue.test.ts:282`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L179), [`task-queue.test.ts:311`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L208))
- FR-20.1b: `setColumns` writes only the given allow-listed task columns
  WITHOUT touching status or updated_at, issues no SQL for an empty column
  set, and throws on any key outside `SETTABLE_TASK_COLUMNS` — identically
  in the Pg adapter and the in-memory double, so a typo'd column fails
  loudly in tests instead of silently no-oping in production; the double
  additionally assigns the columns onto the seeded row and stays a no-op
  for an unknown task id. ([validated by `task-queue.test.ts:635`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L411), [`task-queue.test.ts:654`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L430), [`task-queue.test.ts:667`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L443), [`task-queue.test.ts:674`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L450), [`task-queue.test.ts:686`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L462), [`task-queue.test.ts:698`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L474))
- FR-20.1c: `activeTaskByIssue` returns null for a task that no longer holds its issue: `failed`, `cancelled` or `retried`. A `retried` task handed its work to the retry, so it must not block the issue from being picked again (#2009). A `completed` task still guards it *(amended 2026-09-14, #2069)*: completed means its pull request awaits review, and treating it as terminal made the backlog loop start the same ticket again on the same branch. On 2026-09-14, re-cinq/Otto#19's second run pushed five rounds of commits onto PR #231 one minute after the first run had marked it ready for review, and #1948 was re-run fourteen minutes after its fix merged. ([validated by `task-queue.test.ts:608`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L384), [`task-queue.test.ts:616`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L392), [`task-queue.test.ts:624`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L400))
- FR-20.1a: The `pipeline.tasks` queue, exercised end-to-end against Postgres,
  backs those port behaviors: a created task defaults to `pending` status and
  `normal` priority (accepting an explicit `immediate`); a claim is atomic (a
  second claim of the same row takes nothing); the claim query applies a 30s
  grace window that excludes just-created tasks yet lets an `immediate` task
  through without the grace; a task walks `pending → running → completed`,
  recording a transition event per step for the audit trail and a
  `failure_reason` on failure; the review loop increments `review_iteration`;
  and run-now flips a pending task's priority from `normal` to `immediate`.
  ([validated by `creates a task in pending status`](apps/lore-api/src/integration-tests/pipeline.test.ts#L28), [validated by `claims a task atomically`](apps/lore-api/src/integration-tests/pipeline.test.ts#L38), [validated by `30s grace period excludes recently created tasks`](apps/lore-api/src/integration-tests/pipeline.test.ts#L68), [validated by `full lifecycle pending running completed`](apps/lore-api/src/integration-tests/pipeline.test.ts#L86), [validated by `records task events for audit trail`](apps/lore-api/src/integration-tests/pipeline.test.ts#L118), [validated by `handles failure with reason`](apps/lore-api/src/integration-tests/pipeline.test.ts#L149), [validated by `tracks review iterations`](apps/lore-api/src/integration-tests/pipeline.test.ts#L171), [validated by `creates tasks with default priority normal`](apps/lore-api/src/integration-tests/pipeline.test.ts#L192), [validated by `creates tasks with explicit priority immediate`](apps/lore-api/src/integration-tests/pipeline.test.ts#L202), [validated by `GKE worker query picks up immediate tasks without grace`](apps/lore-api/src/integration-tests/pipeline.test.ts#L212), [validated by `run-now updates priority from normal to immediate`](apps/lore-api/src/integration-tests/pipeline.test.ts#L234))
- FR-20.2: The `TaskQueue` port also drives spec-task DAG dispatch: it
  claims a pending spec-task once via CAS (default claimer
  `spec-task-executor`), completes it reporting only the same-spec
  dependents it unblocks (false when not running), exposes
  `awaitingApproval`/`distinctTargetRepos`/`prInfo`, and returns ready
  spec-tasks whose deps are completed/merged in the same spec — scoping
  the returned set to one repo while still resolving deps org-wide.
  Nothing dispatches a spec-task any more: the executor that did, and the
  admission rules that capped a plan's group at three concurrent tasks, are
  removed *(rewritten 2026-10-07, `specs/external-floor` FR15.0)*. The
  generic claim still never takes one — it holds no recipe for them and
  ignores their dependencies, and on 2026-09-29 it grabbed the tasks the
  executor was holding back, filed an Issue for each and failed them all —
  so these port methods answer for the rows that already exist and for
  nothing new. A plan's tasks reach the implementation loop as tickets
  (`specs/7-feature-planning` FR-11.13).
  ([`task-queue.test.ts:447`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L263), [`task-queue.test.ts:469`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L285), [`task-queue.test.ts:479`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L295), [`task-queue.test.ts:530`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L530, [validated by leaves spec-tasks to the spec-task executor](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L33), [validated by creates nothing when lore/x exists](libs/shared/src/outbound/project/repo/ensure-branch.test.ts#L34)))
- FR-20.3: The repo-scoped `TaskStore` port queries pending statuses,
  transitions a cancel to `cancelled`, writes `setStatus` (status +
  updated_at + only allowlisted extra columns), reads-old-then-writes-new
  status recording the transition event on `updateStatus`, and filters
  `findOpenLike` by repo, type, description prefix, and given statuses —
  each bound to the facade's repo. ([validated by `task-store-pg.test.ts:23`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L23), [`task-store-pg.test.ts:38`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L38), [`task-store-pg.test.ts:51`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L51), [`task-store-pg.test.ts:68`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L68), [`task-store-pg.test.ts:82`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L82))
- FR-20.3b: The in-memory `TaskStore` double is the behavioral spec of the
  Pg adapter across the whole port surface: the pending/running/executed
  views group the shared status unions newest-first per repo; `create`
  inserts a `pending` task with resolved priority, records the creation
  event, applies the trust gate only for a seeded repo, and rejects
  over-long descriptions; `retry` copies a failed task with a `retry_of`
  bundle marking the old one `retried` and refuses non-retryable states;
  `setStatus` writes only allowlisted extras (silently skipping unknown
  keys, matching `setTaskStatus`), `setStatusIf` is a CAS, `updateStatus`
  records the old-to-new event, and `cancel`/`markMerged` enforce the
  state guards; `transition` keeps `claimed_by` via COALESCE; and the
  dedup reads (`findOpenLike` with LIKE-wildcard semantics,
  `driftTasksForSpec` keyed on the bundle's spec_path), `list` paging, and
  `getWithEvents` mirror the SQL. ([validated by `task-store-memory.test.ts:38`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L38), [`task-store-memory.test.ts:48`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L48), [`task-store-memory.test.ts:69`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L70), [`task-store-memory.test.ts:90`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L91), [`task-store-memory.test.ts:100`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L109), [`task-store-memory.test.ts:125`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L134), [`task-store-memory.test.ts:137`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L146), [`task-store-memory.test.ts:149`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L158), [`task-store-memory.test.ts:157`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L166), [`task-store-memory.test.ts:171`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L180), [`task-store-memory.test.ts:194`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L203), [`task-store-memory.test.ts:226`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L221), [`task-store-memory.test.ts:274`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L269), [`task-store-memory.test.ts:362`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L303), [`task-store-memory.test.ts:376`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L317), [`task-store-memory.test.ts:392`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L333))
- FR-20.4: The task-list surface returns the repo's pending tasks as
  typed `Task` wrappers and reflects the new status after `cancel()`.
  ([validated by `task-list.test.ts:114`](libs/shared/src/outbound/project/tasks/task-list.test.ts#L96), [`task-list.test.ts:126`](libs/shared/src/outbound/project/tasks/task-list.test.ts#L113))
- FR-20.5: The `EventReporter` port is the produce side of `pipeline.events`
  and nothing more: `insert` writes through the shared idempotent statement
  and collapses a redelivery sharing a dedupe key. Claiming, acking,
  failing with backoff, reaping and pruning happen on the subscriber's own
  `pipeline.event_deliveries` row (ADR-044), never on the event. ([validated by `event-reporter.test.ts:9`](libs/shared/src/outbound/project/events/event-reporter.test.ts#L9), [`event-reporter.test.ts:26`](libs/shared/src/outbound/project/events/event-reporter.test.ts#L26), [`event-reporter.test.ts:55`](libs/shared/src/outbound/project/events/event-reporter.test.ts#L55), [`event-deliveries.contract.test.ts:116`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L116), [`event-deliveries.contract.test.ts:152`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L152), [`event-deliveries.contract.test.ts:203`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L203), [`event-deliveries.contract.test.ts:295`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L295))
- FR-20.6: The `Chunks` knowledge-store port checks schema existence via
  `information_schema`, counts/inserts/deletes chunks within an
  interpolated (injection-rejecting) schema, sets the caller-formatted
  embedding vector, resolves the repo's team schema (falling back to
  `org_shared`) for the spec-chunk and code-symbol reads, for
  chunk-existence checks, and for the coverage
  spec-chunk reads (with and without embeddings) ordered by `file_path` then
  `metadata.chunk_index` nulls-last then `ingested_at` so multi-chunk
  specs reassemble in document order — and returns distinct teams with per-team `org_shared`
  counts (defaulting a missing count to zero). Rows predating team
  tracking carry a null team and are left out of that list.
  Test-range and backfill reads take `code` and `test` rows alike (link resolution and backfill candidates are tests); symbol reads stay `code`-only.
  ([validated by returns true when information_schema lists the schema](libs/shared/src/outbound/project/chunks/chunks.test.ts#L49), [`chunks.test.ts:241`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L242), [`chunks.test.ts:56`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L57), [`chunks.test.ts:62`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L63), [`chunks.test.ts:72`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L73), [`chunks.test.ts:87`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L88), [`chunks.test.ts:104`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L105), [`chunks.test.ts:112`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L113), [`chunks.test.ts:123`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L124), [`chunks.test.ts:137`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L138), [`chunks.test.ts:145`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L146), [`chunks.test.ts:151`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L152), [`chunks.test.ts:159`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L160), [`chunks.test.ts:177`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L178), [`chunks.test.ts:196`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L197), [`chunks.test.ts:218`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L219), [`chunks.test.ts:265`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L275), [`chunks.test.ts:279`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L289), [`chunks.test.ts:287`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L297), [`chunks.test.ts:331`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L341), [`chunks.test.ts:363`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L373), [`chunks.test.ts:373`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L405), [`chunks.test.ts:384`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L416), [`chunks.test.ts:399`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L431), [`chunks.test.ts:408`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L440), [`chunks.test.ts:415`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L447), [`chunks.test.ts:437`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L469), [`chunks.test.ts:460`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L492), [`chunks.test.ts:468`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L500), [`chunks.test.ts:497`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L529), [`chunks.test.ts:511`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L543), [`chunks.test.ts:674`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L706), [`chunks.test.ts:707`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L739))
- FR-20.7: The HTTP `Chunks` adapter reads spec chunks (and backfill
  chunks with embeddings) from the repo-scoped API with a bearer token,
  maps `hasChunk` to its query endpoint, and throws
  on a non-ok response and on the Floor-only write surface. ([validated by `chunks-http.test.ts:28`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L28), [`chunks-http.test.ts:43`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L43), [`chunks-http.test.ts:60`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L57), [`chunks-http.test.ts:94`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L91))
- FR-20.12: The `AgentDefs` port resolves an agent definition through
  three layers (yaml base → org row → project row), inheriting nullable
  fields upward and letting each higher layer override, returning null
  when every layer is null; the Pg adapter binds the name and repo,
  qualifies the `lore.repos` JOIN columns, and creates/deletes the repo's
  project row scoped to the repo; the offline files adapter resolves a
  shipped agent, lists them sorted by name, and returns null for an
  unknown name; the facade
  lists and delegates create/delete with the bound repo; and the HTTP
  adapter resolves/lists via the bearer-authed API (null on 404).
  ([validated by returns the org row as stored when no project row exists](libs/shared/src/outbound/project/agents/agent-defs-port.test.ts#L17), [returns null when every layer is null](libs/shared/src/outbound/project/agents/agent-defs-port.test.ts#L21), [inherits a nullable field from org when the project row leaves it null](libs/shared/src/outbound/project/agents/agent-defs-port.test.ts#L50), [merges a project row's model over the org default, inheriting its prompt and timeout](libs/shared/src/outbound/project/agents/agent-defs-pg.test.ts#L47), [returns null when no agent of that name exists in the database](libs/shared/src/outbound/project/agents/agent-defs-pg.test.ts#L63), [binds the agent name and repo on resolve](libs/shared/src/outbound/project/agents/agent-defs-pg.test.ts#L69), [qualifies selected columns so the lore.repos JOIN is not ambiguous](libs/shared/src/outbound/project/agents/agent-defs-pg.test.ts#L78), [creates a project row scoped to the repo and returns the definition](libs/shared/src/outbound/project/agents/agent-defs-pg.test.ts#L89), [`agent-defs.test.ts:55`](libs/shared/src/outbound/project/agents/agent-defs.test.ts#L55), [`agent-defs.test.ts:63`](libs/shared/src/outbound/project/agents/agent-defs.test.ts#L63), [`agent-defs-http.test.ts:56`](libs/shared/src/outbound/project/agents/agent-defs-http.test.ts#L56), [`agent-defs-http.test.ts:65`](libs/shared/src/outbound/project/agents/agent-defs-http.test.ts#L65), [`agent-defs-http.test.ts:71`](libs/shared/src/outbound/project/agents/agent-defs-http.test.ts#L71), [validated by returns null for an agent with no file](libs/shared/src/outbound/project/agents/agent-defs-files.test.ts#L40), [validated by lists general and review sorted by name, review carrying test_policy none on config](libs/shared/src/outbound/project/agents/agent-defs-files.test.ts#L46))
- FR-20.13: The `Workspace`/`Git` ports carry the installation token as a
  base64 `x-access-token` `http.extraheader` override (honouring a
  non-default host, never embedding the raw token in the args or
  `.git/config`) and build a credential-free https URL when tokenless;
  the git CLI clones and reads a seeded file, writes/commits on a new
  branch and pushes (falling back to the Lore Agent identity), and
  `ensureClone`/`ensureCheckout` cache-reuse via fetch, pin the branch,
  and refuse to switch a dirty tree; the workspace facade writes-then-
  reads a file committing through the GitPort and pushes then opens the
  PR via the pulls port. ([validated by `git-auth.test.ts:5`](libs/shared/src/outbound/project/workspace/git-auth.test.ts#L5), [`git-auth.test.ts:14`](libs/shared/src/outbound/project/workspace/git-auth.test.ts#L14), [`git-auth.test.ts:20`](libs/shared/src/outbound/project/workspace/git-auth.test.ts#L20), [`git-auth.test.ts:26`](libs/shared/src/outbound/project/workspace/git-auth.test.ts#L26), [`git-cli-auth.test.ts:20`](libs/shared/src/outbound/project/workspace/git-cli-auth.test.ts#L20), [`git-cli-auth.test.ts:33`](libs/shared/src/outbound/project/workspace/git-cli-auth.test.ts#L33), [`git-cli-auth.test.ts:44`](libs/shared/src/outbound/project/workspace/git-cli-auth.test.ts#L44), [`git-cli.test.ts:47`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L47), [`git-cli.test.ts:57`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L57), [`git-cli.test.ts:75`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L75), [`git-cli.test.ts:94`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L94), [`git-cli.test.ts:105`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L105), [`git-cli.test.ts:123`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L123), [`workspace.test.ts:33`](libs/shared/src/outbound/project/workspace/workspace.test.ts#L33), [`workspace.test.ts:46`](libs/shared/src/outbound/project/workspace/workspace.test.ts#L46))
- FR-20.14: The `Repo` files port reads a file at a given ref (null when
  absent) and creates a branch committing a file via the API, repo bound.
  ([validated by `repo-files.test.ts:54`](libs/shared/src/outbound/project/repo/repo-files.test.ts#L55), [`repo-files.test.ts:56`](libs/shared/src/outbound/project/repo/repo-files.test.ts#L61), [`repo-files.test.ts:62`](libs/shared/src/outbound/project/repo/repo-files.test.ts#L67))
- FR-20.15: The `PullRequests` port lists only the repo's PRs, merges by
  number with the requested method, and exposes PR reads bound to the
  repo and number. ([validated by `pull-requests.test.ts:106`](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L108), [`pull-requests.test.ts:142`](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L144), [`pull-requests.test.ts:151`](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L153))
- FR-20.16: The `Issues` port returns the GitHubPort issues for the
  project's repo, creates an issue bound to the repo, and comments,
  closes, and labels by number bound to the repo. ([validated by `issues.test.ts:58`](libs/shared/src/outbound/project/issues/issues.test.ts#L63), [`issues.test.ts:98`](libs/shared/src/outbound/project/issues/issues.test.ts#L107), [`issues.test.ts:111`](libs/shared/src/outbound/project/issues/issues.test.ts#L120))
- FR-20.17: The `TestRunner` port lists tests in a trusted sandbox (no
  `LORE_DB_HOST`); its exec adapter lists the descriptors from the
  manifest `list` command, runs a single test aggregating the report, and
  runs `run` once per file (selector = file) fanning the result to each
  descriptor. ([validated by `test-suite.test.ts:37`](libs/shared/src/outbound/project/test-runner/test-suite.test.ts#L37), [`test-runner-exec.test.ts:36`](libs/shared/src/outbound/project/test-runner/test-runner-exec.test.ts#L36), [`test-runner-exec.test.ts:44`](libs/shared/src/outbound/project/test-runner/test-runner-exec.test.ts#L44), [`test-runner-exec.test.ts:58`](libs/shared/src/outbound/project/test-runner/test-runner-exec.test.ts#L58))
- FR-20.18: The accounting ports persist their own tables: `usage`
  inserts an `llm_calls` row (defaulting cost and null task) and returns
  today/total counts (missing rows default to zero); `cost` upserts
  `pipeline.anthropic_cost_daily` keyed on `(bucket_date, model)` —
  appending an unseen pair, replacing a same-key row, keeping separate
  rows per model; `job_runs` inserts a running row returning its id,
  marks it completed/failed with summary/error and log path (defaulting
  the path to null) and selects the most-recent `started_at` for a job
  (null when never run); and `baseline` inserts a JSON-serialized counter snapshot and
  reads windowed PR/median-time-to-merge counters from `pipeline.tasks`
  (defaulting an empty window to zero/null, excluding other repos and
  out-of-window rows). ([validated by `usage-pg.test.ts:22`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L31), [`usage-pg.test.ts:50`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L79), [`usage-pg.test.ts:114`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L143), [`usage-pg.test.ts:129`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L158), [`usage-pg.test.ts:144`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L173), [`usage-pg.test.ts:160`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L189), [`usage-pg.test.ts:173`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L202), [`usage-pg.test.ts:190`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L219), [`usage-pg.test.ts:206`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L235), [`cost.test.ts:36`](libs/shared/src/outbound/project/cost/cost.test.ts#L36), [`cost.test.ts:60`](libs/shared/src/outbound/project/cost/cost.test.ts#L60), [`cost.test.ts:68`](libs/shared/src/outbound/project/cost/cost.test.ts#L68), [`cost.test.ts:80`](libs/shared/src/outbound/project/cost/cost.test.ts#L80), [`job-runs.test.ts:23`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L23), [`job-runs.test.ts:36`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L36), [`job-runs.test.ts:54`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L54), [`job-runs.test.ts:62`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L62), [`job-runs.test.ts:72`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L72), [`job-runs.test.ts:86`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L86), [`job-runs.test.ts:94`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L94), [`job-runs.test.ts:104`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L104), [`job-runs.test.ts:118`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L118), [`job-runs.test.ts:131`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L131), [`job-runs.test.ts:172`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L172))
- FR-20.18a: The in-memory `Usage` double mirrors the Pg write-time
  correlation as its behavioral spec: a seeded task id lands on `task_id`;
  a non-task id that matches a seeded assembly line falls back to
  `assembly_line_id`; an agent CR name resolves to the LAST registered
  node (the `ORDER BY n.id DESC LIMIT 1` lateral); an unknown-but-valid
  uuid with an unmatched CR stores the row uncorrelated (both ids null)
  instead of rejecting it — a non-uuid id is out of contract, erroring in
  Pg's `::uuid` cast; the write defaults (cost 0, status success, null
  error) apply; and
  `processedCounts` splits today (past local midnight) from total.
  ([validated by `usage-memory.test.ts:12`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L12), [`usage-memory.test.ts:25`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L25), [`usage-memory.test.ts:38`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L38), [`usage-memory.test.ts:87`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L87), [`usage-memory.test.ts:103`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L103), [`usage-memory.test.ts:117`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L133))
- FR-20.19: The `Archive` GCS port saves to `<bucket>/<key>`
  non-resumable with the given content type (passing `cacheControl`
  through as file metadata) and returns the object content as utf-8, null
  when the object is absent or the storage call throws. ([validated by `archive-gcs.test.ts:38`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L37), [`archive-gcs.test.ts:54`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L54), [`archive-gcs.test.ts:72`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L72), [`archive-gcs.test.ts:82`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L82), [`archive-gcs.test.ts:91`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L91))
- FR-20.20: Chunk-schema resolution is single-sourced in the shared
  `chunk-schema` module: a candidate schema name is kept only when it is
  regex-safe and provisioned (an invalid, injection-shaped, or absent
  name falls back to `org_shared` without an existence check, and
  `org_shared` itself short-circuits); a repo resolves through
  `lore.repos.team` to its provisioned team schema, else `org_shared`
  (no team, or an unprovisioned team schema, both fall back); the
  resolution is memoized per pool so concurrent readers share one
  lookup, pools stay isolated, and a failed lookup is never cached; and
  the schema enumeration lists every provisioned `chunks` schema,
  dropping regex-unsafe names and always including `org_shared` exactly
  once. ([validated by `chunk-schema.test.ts:29`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L27), [`chunk-schema.test.ts:35`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L35), [`chunk-schema.test.ts:41`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L41), [`chunk-schema.test.ts:48`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L48), [`chunk-schema.test.ts:57`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L57), [`chunk-schema.test.ts:66`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L66), [`chunk-schema.test.ts:78`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L78), [`chunk-schema.test.ts:87`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L87), [`chunk-schema.test.ts:95`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L95), [`chunk-schema.test.ts:110`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L110), [`chunk-schema.test.ts:123`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L123), [`chunk-schema.test.ts:150`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L150), [`chunk-schema.test.ts:163`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L163))
- FR-20.21: Legacy chunk relocation runs when a repo's team changes
  (`internal.repo.team_changed`, handled on the Floor): it MOVEs any rows
  the repo still holds in `org_shared.chunks` into its resolved schema — per-file
  dedupe keeps a file already fresh in the target and drops its stale
  org_shared duplicates, files absent from the target relocate wholesale
  preserving id, embedding, and `ingested_at`, rewriting `team`, stamping
  `metadata.migrated_from` ([validated by `chunks.test.ts:572`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L604), [`chunks.test.ts:589`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L621), [`chunks.test.ts:622`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L654))
  - Provenance-less rows with a classifyFile content type are adopted via
    `ingested_by = 'reindex-job'`; other content types relocate unowned ([validated by `chunks.test.ts:572`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L604), [`chunks.test.ts:612`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L644))
  - The Pg adapter issues copy and delete as one statement (shared
    snapshot, insert before delete, repo and team as bind parameters),
    a clean repo is a zero no-op, and `org_shared` is rejected as a
    relocation target in every adapter — self-relocation would dedupe
    rows against themselves and delete them ([validated by `chunks.test.ts:635`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L667), [`chunks.test.ts:646`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L678), [`chunks.test.ts:658`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L690))
  - The station HTTP adapter refuses relocation as Floor-only ([validated by `chunks-http.test.ts:94`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L91))
  - `PUT /api/repos/:o/:r/settings` on lore-api emits one
    `internal.repo.team_changed` event only when the write actually changes
    the team value (settings-only patches and same-value writes emit
    nothing), and a failed event insert degrades to the nightly relocation
    instead of failing the settings write that already happened. It REFUSES
    a patch carrying a `dark_factory` block (400, writing nothing at all):
    those settings were removed on 2026-10-02 and nothing reads them. The
    web-ui route forwards to it,
    normalizing a cleared team to null, and passes the refusal through
    with its status ([validated by forwards a team change to lore-api](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L32), [`route.test.ts:43`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L43), [`route.test.ts:51`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L51), [`route.test.ts:61`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L61), [`route.test.ts:76`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L76), [`repo-settings.test.ts:31`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L31), [`repo-settings.test.ts:35`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L35), [`repo-settings.test.ts:43`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L43), [`repo-settings.test.ts:43`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L43), [`repo-settings.test.ts:66`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L66), [`repo-settings.test.ts:146`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L88), [`repo-settings.test.ts:169`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L111), [`repo-settings.test.ts:66`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L66), [`repo-settings.test.ts:146`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L88), [`repo-settings.test.ts:169`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L111), [`repo-settings.test.ts:186`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L128), [`repo-settings.test.ts:216`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L214), [`repos.test.ts:128`](apps/web-ui/src/lib/api/repos.test.ts#L128))
  - The `team_changed` handler, in the stations service since 2026-10-02, re-reads the team from `lore.repos`
    rather than trusting the event payload, resolves it through the uncached
    single-sourced `chunkSchemaOrOrgShared` (never the per-repo memoized
    resolver, which would serve the pre-change schema for its TTL), no-ops
    when resolution falls back to `org_shared`, and lets a relocation error
    propagate so the event loop retries the idempotent move ([validated by moves re-cinq/lore's legacy org_shared rows into platform, the schema its team resolves to](apps/stations/src/events/team-changed.test.ts#L26), [relocates nothing for a repository whose team resolves to org_shared](apps/stations/src/events/team-changed.test.ts#L37), [hands a cleared team to the resolver as null instead of deciding here](apps/stations/src/events/team-changed.test.ts#L48), [says there was nothing to move when the repository had no legacy rows](apps/stations/src/events/team-changed.test.ts#L56), [throws connection reset when the move fails, so the delivery is retried](apps/stations/src/events/team-changed.test.ts#L66))

## Non-Functional Requirements

### NFR-1: Security

- No long-lived credentials anywhere in the system. ([validated by `security-posture.test.ts:75`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L75), [`security-posture.test.ts:96`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L96))
- Workload Identity for all GKE workloads. ([validated by `security-posture.test.ts:67`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L67))
- Workload Identity Federation for GitHub Actions. ([validated by `security-posture.test.ts:92`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L92), [`security-posture.test.ts:96`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L96))
- Schema-per-team isolation in the vector store. ([validated by `chunks.test.ts:166`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L167), [`chunks.test.ts:184`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L185))
- Secret and PII redaction runs at ingest time and on every memory write:
  `sanitizeContent()` / `redactSecrets()` strip API keys, JWTs, private keys,
  connection strings, and bearer tokens before storage in the org-wide
  database. ([validated by `redact.test.ts:5`](libs/shared/src/lib/redact.test.ts#L5), [`redact.test.ts:78`](libs/shared/src/lib/redact.test.ts#L78))
- Centralized auth in `routes.ts`: every `/api/*` route enforces bearer
  token validation. Supports legacy single token (`LORE_INGEST_TOKEN`)
  and per-client scoped tokens with SHA-256 hashes. ([validated by `auth.test.ts:56`](apps/lore-api/src/transport/http/auth.test.ts#L56), [`bearer-scope.test.ts:41`](apps/lore-api/src/transport/http/bearer-scope.test.ts#L41), [returns 403 {error:insufficient scope} when the token is not legacy and pool is null](apps/lore-api/src/transport/http/bearer-scope.test.ts#L48), [returns 403 when the DB has no matching token](apps/lore-api/src/transport/http/bearer-scope.test.ts#L59), [grants any scope when the DB token has admin](apps/lore-api/src/transport/http/bearer-scope.test.ts#L87), [returns 403 when the DB token lacks the scope the route needs](apps/lore-api/src/transport/http/bearer-scope.test.ts#L100), [returns 403 when the token lookup query throws](apps/lore-api/src/transport/http/bearer-scope.test.ts#L113), [grants access via the legacy token without hitting the DB](apps/lore-api/src/transport/http/bearer-scope.test.ts#L126))
- Rate limiting: 30/min webhooks, 60/min task ops, 200/min other
  (in-memory sliding window). 1 MB body size limit. ([validated by `rate-limit.test.ts:53`](apps/lore-api/src/transport/http/rate-limit.test.ts#L52), [`rate-limit.test.ts:39`](apps/lore-api/src/transport/http/rate-limit.test.ts#L39), [`auth.test.ts:17`](apps/lore-api/src/transport/http/auth.test.ts#L17), [`webhook-incident.test.ts:144`](apps/lore-api/src/transport/routes/webhooks/webhook-incident.test.ts#L144))
- Decision: Slack indexing is opt-in per channel only and DMs are never indexed; Lore indexes no Slack content today, so there is nothing to test yet.

### NFR-2: Reliability & Freshness

- `lore_assemble_context` warns when repo context is stale (>7 days since
  last ingest) or missing (first-run welcome with suggested actions). ([validated by `context-freshness.test.ts:9`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L35), [`context-freshness.test.ts:15`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L41), [`context-freshness.test.ts:21`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L47), [`context-freshness.test.ts:25`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L51), [`context-freshness.test.ts:31`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L57))
- When the MCP server is unreachable, Claude Code MUST fall back to
  the last-synced local copy of CLAUDE.md files and ADRs in
  `~/.re-cinq/lore` and display a one-time warning to the developer
  that search quality may be degraded. Semantic search is unavailable
  in this mode; convention and ADR lookups continue from local files. ([validated by `context-tools.test.ts:56`](apps/mcp-server/src/transport/tools/context-tools.test.ts#L56), [`context-tools.test.ts:102`](apps/mcp-server/src/transport/tools/context-tools.test.ts#L102))

## Operational Targets & Constraints (Background)

The targets and deployment constraints below are operational context rather
than unit-tested behaviour; they are tracked here for the platform team and
enforced by benchmarking, infrastructure configuration, and review process.

**Performance targets (aspirational).**

- Context search returns results in under 200ms (p99) once
  infrastructure is deployed. **Note (2026-03-28):** Hybrid search
  (Vertex AI embedding + HNSW + BM25 + RRF) is functional end-to-end
  but p99 latency has not been benchmarked yet. The 200ms target
  remains aspirational until measured under load.
- Install script completes in under 5 minutes.
- Session start context sync completes in under 5 seconds.
- Incremental ingestion completes within 5 minutes of a merge.

**Reliability posture.**

- Install script is idempotent with no side effects on re-run.
- Platform hooks fail silently rather than blocking developer work.
- Health check script diagnoses all connection issues with fix
  instructions.
- Agent deployments do NOT affect running Job pods — tasks survive
  rollout restarts.

**Scalability and infrastructure.**

- CloudNativePG (CNPG) PostgreSQL instance on existing shared GKE
  cluster (`your-gke-cluster`, `europe-west1`). Scale up CNPG resource
  requests when query latency p99 exceeds 50ms. Upgrade path to
  AlloyDB Omni or managed AlloyDB if needed.
- GKE cluster is shared — Lore workloads run in dedicated namespaces
  (`mcp-servers`, `lore-agent`, `lore-ui`) on the existing cluster.
- Revisit vector store choice only if corpus exceeds 100M vectors.

**Governance.**

- Root CLAUDE.md changes require broad review (platform-eng +
  tech-leads).
- Team CLAUDE.md files owned by respective teams.
- ADR changes require arch-group + affected team review.
- Architecture decisions changed only via superseding ADR with
  full alternatives-rejected documentation.

## Clarifications

**Session 2026-03-25**

- Q: What happens when the MCP server is unreachable during a developer session? → A: Fall back to local `~/.re-cinq/lore` files with a one-time warning that search quality is degraded.
- Q: What happens to ingested chunks when their source is deleted, reverted, or superseded? → A: Hard delete. Nightly re-index removes chunks whose source no longer exists. No stale content retained.
- Q: How are concurrent task claims resolved? → A: `SELECT ... FOR UPDATE SKIP LOCKED` — atomic, no versioning overhead. Claim attempt on taken task returns immediate error.
- Q: What happens when a Lore Agent Job pod fails mid-task? → A: Fail immediately, update pipeline task with error reason, post Slack notification if channel mapped. No automatic retry — developer decides whether to resubmit via `lore_retry_task`.
- Q: How does the PR check transition from warning to enforcement mode? → A: Manual flip by platform team via CI config flag. No automatic date-based cutoff.

**Session 2026-04-13 (spec update)**

- Q: Why was Beads replaced? → A: Beads + Dolt had integration complexity and `bd` CLI instability. Pipeline tasks in PostgreSQL provide atomic claiming, dependency tracking, and full audit history without an external CLI dependency. (ADR-009)
- Q: How does the Lore Agent service run tasks? → A: A TypeScript worker in the `lore-agent` namespace polls the `pipeline.tasks` table and dispatches by task type. Feature-request runs in-process via direct Anthropic API calls and the worker creates the PR; onboarding (since 2026-09-17) enrols the repo in-process and then walks the `onboard` assembly line, whose push node opens its one PR. Complex tasks (implementation, general, review) run in ephemeral `claude-runner` Job pods created via the LoreTask CRD, with pre-run context hydration, deterministic validation, and full lifecycle control. (ADR-007)
- Q: Why no Graphiti / FalkorDB? → A: PostgreSQL-backed live knowledge graph provides the same traversable fact store without an additional graph database dependency. (ADR-010)
- Q: Why no OCI Context Cores? → A: DB-cached context assembly with the `lore_assemble_context` tool provides equivalent freshness guarantees without OCI registry infrastructure overhead. (ADR-010)

**Session 2026-04-20 (spec update — ADR-015 + post-April-13 work)**

- Q: Why switch from cron-polling to webhooks for the review reactor? → A: Polling every 5 minutes burned API quota and GitHub rate-limit budget on ticks that did nothing. Webhooks fire only on actual PR state changes; review latency drops from avg ~2.5 min to seconds. (ADR-015)
- Q: Why keep the safety-net cron at all? → A: A dropped webhook delivery stalls a PR until a human notices. A business-hours safety cron is nearly free and catches stragglers. Off-hours ticks are a pure waste so the cron is gated by `isBusinessHours()`. (ADR-015)
- Q: Why was the context budget cut from 16K to 8K by default? → A: Implementation and review flows only need conventions + the immediate diff. 16K was over-sending context and paying unnecessary token costs. Research keeps 16K because it needs broad memory coverage. (ADR-015)
- Q: Why prompt-cache at the system + tool-schema boundary separately? → A: A tool-schema edit would otherwise bust the system-prompt cache entry. Separate breakpoints ensure each can be reused independently. (ADR-015)
- Q: What is the `LORE_WEBHOOK_SECRET` latent bug that ADR-015 fixed? → A: The secret existed in GCP Secret Manager and had an ExternalSecret CR, but was never mounted into the mcp-server pod. `handleGitHubWebhook` always returned `503 "webhook secret not configured"`. ADR-015 mounted the secret and the webhook path now validates HMAC signatures correctly.
- Q: Why add `FR-18` (stuck-task recovery) now? → A: Job pods that exit without writing a terminal status left tasks stuck in `running` forever. The loretask-watcher had no mechanism to detect this until the `stale_task_check` hourly job was added (commit f203952, 2026-04-20).

## Scope & Out of Scope

**In Scope**

- Context repository structure and content.
- MCP server (file-backed Phase 0, PostgreSQL/pgvector-backed Phase 1+).
- Developer onboarding (install script, health check, settings merge).
- Task tracking integration (pipeline tasks + GitHub Issues + AGENTS.md + hooks).
- Spec-driven feature workflow (skills + `lore_assemble_context`).
- PR quality enforcement (template + CI check).
- Ingestion pipeline (Lore Agent service on GKE).
- Observability (OpenTelemetry + Cloud Monitoring).
- Context evaluation (nightly GitHub Actions job that asks lore-api, #2443).
- Gap detection (automated drafting + PR opening).
- Live knowledge graph (PostgreSQL entities + edges).
- Intelligent memory lifecycle (passive capture, decay, consolidation).
- Autonomous review loop (opt-in per repo, webhook-driven per ADR-015).
- Progressive trust gating.
- Slack integration (`/lore` slash command + watcher notifications).
- Web UI (`/onboard`, pipeline status, run transcripts, analytics, knowledge graph, gaps). ([validated by `GapsView.test.tsx:26`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L26), [`GraphView.test.tsx:35`](apps/web-ui/src/app/graph/GraphView.test.tsx#L35), [`AnalyticsView.test.tsx:111`](apps/web-ui/src/app/analytics/AnalyticsView.test.tsx#L111), [`NodeLogPanel.test.tsx:67`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L67), [`OnboardView.test.tsx:9`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L9))
- Spec drift detection (Phase 2).
- Prompt caching on agent LLM calls (ADR-015).
- Per-template context budgets (ADR-015).
- Stuck-task terminal-state recovery (`stale_task_check` job).

**Out of Scope**

- Chatbot or internal AI assistant product.
- Replacement for GitHub Issues, Jira, or project management tools.
- Documentation platform (indexes existing docs, does not replace).
- Surveillance tooling (opt-in only, no DMs).
- Custom agent orchestration frameworks — use native Claude Code Agent
  Teams for local work, Lore Agent for cluster work.
- Cross-team spec coordination beyond ADR patterns and pipeline task
  dependency links.
- OCI/crane-based Context Core bundles (superseded by DB-cached assembly).
- Graphiti / FalkorDB deployment (superseded by PostgreSQL live graph).
- Beads (`bd` CLI) or Dolt task sync (superseded by pipeline tasks).

## Background: Dependencies

- Claude Code v2.1.32+ (Agent Teams support).
- GCP project with existing GKE cluster (`your-gke-cluster`,
  `europe-west1`) and Cloud Monitoring access (Phase 1+).
- CloudNativePG operator (CNPG) on GKE (Phase 1+, already installed
  on shared cluster).
- Vertex AI `text-embedding-005` for 768-dim embeddings (Phase 1+).
  Auth via Workload Identity — `lore-mcp-server` GCP SA with
  `aiplatform.user` role, bound to `default` SA in `mcp-servers`
  namespace. No API keys.
- GitHub organization with Actions, CODEOWNERS, PR template support,
  and GitHub App installation (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`).
- External Secrets Operator (ESO) pulling from GCP Secret Manager.
- Anthropic API key (for Lore Agent, Phase 1+).
- Slack bot token (`LORE_SLACK_BOT_TOKEN`) for `/lore` slash command
  and watcher notifications (optional).
- `docker/claude-runner/` image for ephemeral Job pods.

## Background: Assumptions

- Developers have Node.js, Python (with uv or pip), and Git installed.
- All product repos are on GitHub within the Acme organization.
- Teams are willing to adopt the PR description template.
- The platform engineering team serves as the Phase 0 pilot.
- Existing ADRs and team conventions can be written up in MADR
  format within Phase 0.
- GCP infrastructure provisioning is approved and budgeted for
  Phase 1.

## Success Criteria (Goals & Non-Goals)

1. A new developer goes from zero to a fully configured Claude Code
   environment in under 5 minutes with a single command.
2. Developers complete the full feature loop (constitution → spec
   → tasks → implementation → PR) without memorizing the sequence.
3. Claude Code correctly answers "why did we make this decision?"
   questions using ingested ADRs and PR history, without manual
   context loading.
4. 85% of context evaluation test cases pass on every merged PR
   that modifies context files.
5. Knowledge gaps are surfaced and drafted automatically within one
   week of first occurrence, with human review before merging.
6. Developer mental overhead is limited to three commands: task
   orientation, feature start, and PR drafting.
7. No long-lived credentials exist anywhere in the deployed system.
8. Pilot team (platform engineering) completes a full feature loop
   naturally before infrastructure investment begins.

## Background: retired with Lore's own Floor (2026-10-02)

These statements described behaviour of `apps/floor`, the assembly-line engine Lore ran itself. It was deleted on 2026-10-02 (epic #2342, ADR-049): the external floor runs every line now, so the tests that validated these went with the code. They are kept as the record of what the old engine did.

- Job pods run as non-root (uid 1000), drop all Linux capabilities,
  disallow privilege escalation. NetworkPolicy restricts egress to
  DNS + HTTPS + internal Lore API only. (Lore's own `ai-agents` chart, which
  set this, was removed with its cluster agent; agent pods are the external
  floor's now, and their security context is its chart's to state.)

- FR-7.5: Beyond chunking and embedding, the Lore Agent drafts missing
  content and opens PRs (the gap-detection drafting path, FR-10).

The system MUST automatically identify and address knowledge gaps.

- FR-10.3: For a repo missing a documentation kind (CLAUDE.md, ADRs, or
  specs), the `gap-detect` job drafts the missing content as a `gap-fill`
  task.

- FR-10.6: The per-repo `gap-detect` job skips repos that are not
  onboarded.

- FR-10.7: It checks the repo's resolved-schema chunks for a CLAUDE.md
  doc chunk, ADR chunks, and spec chunks — filing a `gap-fill` task per
  missing kind, and none when all are present.

- FR-10.9: An in-flight or failed matching `gap-fill` task suppresses a
  duplicate filing.

- FR-20.10: The `AgentRunner` port launches a Station via the injected
  `StationBackend` in cluster mode (passing the execution image, throwing
  when no provider is supplied) and calls the injected `LlmPort` in
  direct mode; agent execution refuses LOCAL mode on the shared server
  (`LORE_DB_HOST` set) yet allows cluster mode there. A cluster run must name its task type: it names the recipe the pod runs, and no recipe stands in for a missing one since `general` was deleted (#2329).

- FR-20.11: The station-mode selector honours explicit `k8s`/`docker`
  overrides and the `inprocess` escape hatch, defaults to `k8s`
  in-cluster and `docker` off-cluster, and ignores an unrecognized value
  falling back to context.
