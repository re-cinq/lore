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
  for a malformed body rather than a `500`. ([validated by `http-transport.test.ts@96ead0cc`](apps/mcp-server/src/transport/http-transport.test.ts#L11), [`http-transport.test.ts@db3e1dd9`](apps/mcp-server/src/transport/http-transport.test.ts#L15), [`http-transport.test.ts@70db86a5`](apps/mcp-server/src/transport/http-transport.test.ts#L19), [`http-transport.test.ts@7a7ec55f`](apps/mcp-server/src/transport/http-transport.test.ts#L25))
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
  `settings.json`) 404s the same as an unsafe name. ([validated by returns false for a non-skills path so the caller falls through to MCP @decfc19f](apps/mcp-server/src/transport/skills-registry.test.ts#L42), [serves settings.json with the org hooks @8c37a94d](apps/mcp-server/src/transport/skills-registry.test.ts#L50), [404s a traversal / unsafe skill name @faf52f29](apps/mcp-server/src/transport/skills-registry.test.ts#L63), [serves a baked skill as a gzip tarball @bffd8a59](apps/mcp-server/src/transport/skills-registry.test.ts#L97), [404s a /skills/ path with no recognized suffix @65601b89](apps/mcp-server/src/transport/skills-registry.test.ts#L74), [returns false for a non-GET method even on a /skills/ path @22d44032](apps/mcp-server/src/transport/skills-registry.test.ts#L85), [serves hooks/claude.tar.gz laid out relative to HOME, carrying the settings the Bash guard is wired in @509a680e](apps/mcp-server/src/transport/skills-registry-hooks.test.ts#L36), [serves the flat settings.json from the Claude bundle, so an init that predates bundles reads the same hooks @f8a96f39](apps/mcp-server/src/transport/skills-registry-hooks.test.ts#L48), [404s a vendor with no bundle and a traversing vendor name alike @c419f3d6](apps/mcp-server/src/transport/skills-registry-hooks.test.ts#L72))
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
  declare `none`. *(amended 2026-09-25, again 2026-10-26)* Under `scoped` and `none` alike a
  linter or formatter runs only over the files or paths it names: the guard refuses a
  whole-repository lint and a lint script, naming `lore_get_ci_failures` as where to read
  that verdict, and a linter `npx` or `dlx` would download, which is how a review pod
  fetched eslint mid-review. Under `none` it lets the lockfile install (`npm ci`) a
  linter needs through and still refuses every other install, a build and a typecheck. The same guard reaches a Gemini pod
  through its own vendor bundle, whose `BeforeTool` hook on `run_shell_command` wraps the
  script and reports a refusal the way gemini-cli reads one, as a `block` decision on
  stdout rather than an exit code. ([validated by is wired as the Bash PreToolUse hook in the settings every pod fetches, at the path the lore-context tarball unpacks to @61ad92b7](apps/mcp-server/src/transport/guard-tests.test.ts#L111), [validated by lets a linter or formatter run over the files it names under policies scoped and none @d0a0e44e](apps/mcp-server/src/transport/guard-tests.test.ts#L328), [validated by refuses a whole-repository lint and a lint script under policies scoped and none @67c3eb45](apps/mcp-server/src/transport/guard-tests.test.ts#L345), [validated by refuses a linter npx or dlx would download under policies scoped and none, and names --no-install @aed772b7](apps/mcp-server/src/transport/guard-tests.test.ts#L362), [validated by names CI's verdict as where to read a whole-repository lint instead @3111bfb2](apps/mcp-server/src/transport/guard-tests.test.ts#L381), [validated by refuses adding a package under policy none even when the command carries --frozen-lockfile or --immutable @892fd78f](apps/mcp-server/src/transport/guard-tests.test.ts#L492), [validated by wires the same guard into the Gemini bundle, which blocks with a decision on stdout rather than an exit code @5996c9e4](apps/mcp-server/src/transport/guard-tests.test.ts#L387), [validated by blocks an install through the Gemini hook and passes a read-only command @4e4acaa2](apps/mcp-server/src/transport/guard-tests.test.ts#L410), [validated by @61c7762d](apps/mcp-server/src/transport/skills-registry-hooks.test.ts#L60), [refuses a bare suite run with the reason the agent needs @dd4421aa](apps/mcp-server/src/transport/guard-tests.test.ts#L141), [refuses every unscoped runner spelling under the default policy @d420eee4](apps/mcp-server/src/transport/guard-tests.test.ts#L150), [lets a runner through when it names files, a workspace, a Go package or a subdirectory @03594c55](apps/mcp-server/src/transport/guard-tests.test.ts#L200), [ignores commands that are not test runners, installs included, under the default policy @b10938ba](apps/mcp-server/src/transport/guard-tests.test.ts#L224), [refuses named tests, builds and every install but the lockfile one a linter needs under policy none @abc86abc](apps/mcp-server/src/transport/guard-tests.test.ts#L239), [stands down under policy any and on an event with no command @4414ae7b](apps/mcp-server/src/transport/guard-tests.test.ts#L269), [counts a dot-relative subdirectory as scoped but never the repo root, whether spelled `.`, `./` or absolute @984016d6](apps/mcp-server/src/transport/guard-tests.test.ts#L279), [sees through a shell wrapper, a quoted command and a direct node_modules binary @b4822310](apps/mcp-server/src/transport/guard-tests.test.ts#L171), [refuses a runner whose scope is only vouched for by a comment, a neighbouring command, an --exclude or a watch flag @9144ace7](apps/mcp-server/src/transport/guard-tests.test.ts#L186), [blocks every Bash call when the recipe declares a policy but the guard script is gone, and stands down when none was declared @930dc3c2](apps/mcp-server/src/transport/guard-tests.test.ts#L294), [inherits config.test_policy from the layer below when a row sets config for another reason, so a review recipe stays at none @41c2dec2](libs/shared/src/outbound/project/agents/agent-defs-port.test.ts#L61), [maps a declared policy onto the LORE_TEST_POLICY env the pod's guard reads, and an unknown one onto nothing @40844ff2](libs/shared/src/domain/task-types/test-policy.test.ts#L5), [sets none on every read-only review recipe, so a review pod cannot run tests, installs or builds at all @ad330748](libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts#L298))
- *(added 2026-10-07)* The guard is the only refusal an agent pod meets: no floor pipeline's agent declares `disallowed_tools`, which Claude would enforce in every permission mode, and every agent names `${LORE_SKILLS_URL}` as its skills source, since without it the floor serves its own `/skills` and the pod never receives the guard. ([validated by fetch their hooks and test guard from Lore's skills registry, never the floor's own @dab3982c](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L2082), [validated by deny no tool, leaving the test guard as the only refusal @efdaabfb](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L2090))
- *(added 2026-10-14; amended 2026-10-26, #3500)* A pod given `LORE_BRANCH_TESTS` may run only the tests its branch created: a test file the branch added, committed since the branch left main, staged, or new and untracked, read with `git` from the pod's clone, runs whole, the acceptance tests the definition of done wrote among them; a test file main already had and the branch edited runs only with a test-name filter (`-t`, `--testNamePattern`, `-k`, `-run`, `--grep`), so main's tests in it stay CI's. The variable names the clone, `/workspace/target`, which the guard reads when the shell is outside it. A runner naming a test file main already had is refused, even beside one the branch created, and the refusal names the file, says CI runs every other test on each push and names `lore_get_ci_failures`; a runner naming no test file is refused too, since a run over a directory or a package sweeps in tests main already had; and a clone that cannot find where its branch left main runs none until `git fetch origin main`. With the variable unset the guard is unchanged. The implementation loop sets it on `tdd-round`, so a round can see its acceptance tests go green before it pushes, where before 2026-10-26 it ran only the test it wrote and handed CI every acceptance red: about four CI round trips per built ticket, 32 minutes each on lore, over the weekend of 2026-10-23. ([validated by lets a round run the test files its branch created, committed, staged or new, from the root or after a cd @1259e18d](apps/mcp-server/src/transport/guard-tests.test.ts#L420), [validated by refuses a round's run of a test file main already had, even beside one the branch created, since CI runs everything else @62653c7e](apps/mcp-server/src/transport/guard-tests.test.ts#L432), [validated by refuses a round's run that names no test file, since a directory or a package sweeps in tests main already had @e2d42f91](apps/mcp-server/src/transport/guard-tests.test.ts#L467), [validated by refuses a named run when the clone cannot tell where its branch left main, and says to fetch main @21c43028](apps/mcp-server/src/transport/guard-tests.test.ts#L476), [validated by leaves a directory run alone when the setting is absent @d30cb34c](apps/mcp-server/src/transport/guard-tests.test.ts#L486), [validated by lets a round run a test it added to a file main already had only by its name, so main's tests in that file stay CI's @b1675b02](apps/mcp-server/src/transport/guard-tests.test.ts#L446), [validated by finds the clone the setting names when the shell is outside it, as before the first cd @32f3718d](apps/mcp-server/src/transport/guard-tests.test.ts#L458))
- The gateway's top-level router tries `/healthz`, then `/skills/*`, before
  falling through to `/mcp`: a non-`/mcp` path 404s, an `/mcp` request missing
  the configured bearer token 401s, and on `/mcp` itself POST mints or resumes
  a session (400 without a session id on a non-initialize body) while
  GET/DELETE require an already-minted session id (400 without one) and any
  other method 405s. ([validated by `answers /healthz without touching /mcp or /skills routing` @2c5ed90f](apps/mcp-server/src/transport/http-transport.test.ts#L51), [`falls through to the skills registry for a /skills path` @8c6cf0b4](apps/mcp-server/src/transport/http-transport.test.ts#L61), [`404s a path that is neither /healthz, /skills, nor /mcp` @d16352e6](apps/mcp-server/src/transport/http-transport.test.ts#L71), [`401s an /mcp request missing the configured bearer token` @7c902caa](apps/mcp-server/src/transport/http-transport.test.ts#L80), [`400s a POST /mcp with no session and a non-initialize body` @c7baa06c](apps/mcp-server/src/transport/http-transport.test.ts#L90), [`400s a GET /mcp with no session id` @7b39e6f1](apps/mcp-server/src/transport/http-transport.test.ts#L105), [`405s an unsupported method on /mcp` @f1eb714b](apps/mcp-server/src/transport/http-transport.test.ts#L117))
- A gateway restart forgets every in-memory session, so a request carrying a
  session id the gateway does not know answers `404` with JSON-RPC code
  `-32001` (POST, GET and DELETE alike), which tells a spec-compliant client
  to re-initialize; a fresh `initialize` mints a new session, and a live
  session keeps being served until it is deleted.
  ([validated by `404s a POST /mcp carrying an unknown session id so the client re-initializes` @176d159f](apps/mcp-server/src/transport/http-transport.test.ts#L154), [`404s a GET and a DELETE /mcp carrying an unknown session id` @ce1e3e69](apps/mcp-server/src/transport/http-transport.test.ts#L173), [`mints a fresh session on initialize after an unknown session 404` @3d38e674](apps/mcp-server/src/transport/http-transport.test.ts#L190), [`keeps serving a live session and 404s it once it is deleted` @0badcf3c](apps/mcp-server/src/transport/http-transport.test.ts#L205), [validated by `400s a GET /mcp whose session id header is empty, as POST does` @4df904cf](apps/mcp-server/src/transport/http-transport.test.ts#L234))
- Developer can check task status and retrieve results without
  leaving Claude Code.
- The pipeline task is visible in the shared task tracker — no
  duplicate work. ([validated by renders the heading and offers no way to create a task @ceb2296d](apps/web-ui/src/app/assembly-runs/AssemblyRunListView.test.tsx#L17))
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

The system MUST provide a single-command install experience. ([validated by `install-contract.test.mjs@9b2c3097`](scripts/install-contract.test.mjs#L23))

- FR-3.1: Install script clones the context repo, builds the MCP
  server, detects team, configures Claude Code settings, installs
  platform skills, and runs health checks. ([validated by `install-contract.test.mjs@9b2c3097`](scripts/install-contract.test.mjs#L23), [`install-contract.test.mjs@7096f206`](scripts/install-contract.test.mjs#L62), [`install-contract.test.mjs@0289a59a`](scripts/install-contract.test.mjs#L78), [`install-contract.test.mjs@bd102bfc`](scripts/install-contract.test.mjs#L91), [`install-contract.test.mjs@a1240a36`](scripts/install-contract.test.mjs#L197), [`install-contract.test.mjs@f6a91be1`](scripts/install-contract.test.mjs#L205), [`install-contract.test.mjs@75235e6f`](scripts/install-contract.test.mjs#L244))
- FR-3.2: Install script is idempotent — re-running always produces
  correct state. ([validated by `install-contract.test.mjs@cb585d91`](scripts/install-contract.test.mjs#L223), [`install-contract.test.mjs@cb585d91`](scripts/install-contract.test.mjs#L223), [`install-contract.test.mjs@ab5e98b5`](scripts/install-contract.test.mjs#L257))
- FR-3.3: Install script works without pre-cloning the repository. ([validated by `install-contract.test.mjs@a871202e`](scripts/install-contract.test.mjs#L36), [`install-contract.test.mjs@2423e386`](scripts/install-contract.test.mjs#L49))
- FR-3.4: Settings merge (via helper script) appends platform hooks
  without overwriting personal developer hooks. ([validated by `lore-merge-settings.test.mjs@162af2ce`](scripts/lore-merge-settings.test.mjs#L25), [`lore-merge-settings.test.mjs@8c74988d`](scripts/lore-merge-settings.test.mjs#L41))
- FR-3.5: Install script registers the `lore-context` MCP server at user scope so Lore works in every repo, and fails with a clear error when `claude` is missing or registration fails. ([validated by `install-contract.test.mjs@2b261cf1`](scripts/install-contract.test.mjs#L97), [`install-contract.test.mjs@3bd3155d`](scripts/install-contract.test.mjs#L104))
- FR-3.6: Install script honours an environment-provided `LORE_API_URL` and `LORE_INGEST_TOKEN` over git config, prompts for a missing URL, and never writes an empty value to git config. ([validated by `install-contract.test.mjs:142`](scripts/install-contract.test.mjs#L142), [`install-contract.test.mjs:155`](scripts/install-contract.test.mjs#L155))
- FR-3.7: `lore-doctor` requires the API URL, the token and a user-scope registration, tells a rejected token apart from an outage, and prints its results line last. ([validated by `install-contract.test.mjs@1b969bbc`](scripts/install-contract.test.mjs#L313), [`install-contract.test.mjs@9ce5f484`](scripts/install-contract.test.mjs#L270), [`install-contract.test.mjs@f861fcf6`](scripts/install-contract.test.mjs#L327), [`install-contract.test.mjs@acc73885`](scripts/install-contract.test.mjs#L357))
- Decision: the `lore-doctor` health-check script tests all connections and
  prints clear pass/fail with fix instructions for each.

### FR-4: Task Tracking Integration

The system MUST provide agent-native task tracking via PostgreSQL
pipeline tasks and GitHub Issues. ([validated by `awaitingApproval selects approval-gated tasks carrying an issue` @395a2432](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L21))

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
  as tickets (`specs/7-feature-planning` FR-11.13), one at a time per repository. ([validated by registers no spec-task tool, since a plan's tasks are implemented from the backlog @e9d57a03](apps/mcp-server/src/transport/tools/pipeline/index.test.ts#L29), [validated by refuses a spec-task at trust level %s, pointing at the backlog loop @4ac792dc](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L163))
- FR-4.5: Concurrent task claiming uses `SELECT ... FOR UPDATE SKIP
LOCKED` — atomically prevents duplicate work without versioning
  overhead. A claim attempt on a taken task returns an immediate
  error; the developer or agent reads the ready list and picks
  another task. ([validated by `task-queue.test.ts@5617af6b`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L7))
- FR-4.6: Every pipeline task automatically creates a GitHub Issue
  on the target repo (labelled `lore-managed`). The issue receives
  status comments and is closed when the PR is created. ([validated by `issues.test.ts@c1c72db5`](libs/shared/src/outbound/project/issues/issues.test.ts#L112), [`issues.test.ts@ab836276`](libs/shared/src/outbound/project/issues/issues.test.ts#L125))
- FR-4.7: Optional approval gates: tasks can require a human to add
  an `approved` label on the GitHub Issue before processing.
  Configured via the settings UI or `lore.settings` table. ([validated by `SettingsView.test.tsx@625dac26`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L126))
### FR-5: Spec-Driven Feature Workflow

- FR-5.2: `/lore-pr` skill drafts PR descriptions from spec, task
  context, and changed files. ([validated by `pr-body.test.ts@e4e85497`](libs/shared/src/domain/pr-body.test.ts#L5), [`pr-body.test.ts@28b73a55`](libs/shared/src/domain/pr-body.test.ts#L11))
- Decision: constitution generation (the `lore-gen-constitution` glue script)
  calls `lore_assemble_context` to populate `.specify/constitution.md` with
  real ADRs and team conventions.

#### Rationale

The platform's skills carry a feature end to end: `/lore-feature` guides the full
loop — constitution generation → specification → task breakdown → pipeline task
wiring — while Claude Code does the mechanical work and the developer confirms
only at decision points (constitution review, spec review, task breakdown review).

### FR-6: PR Quality Enforcement

The system MUST enforce PR description quality from day one. ([validated by `pr-section-check.test.ts@02acdc03`](libs/shared/src/work/pr-section-check.test.ts#L26), [`pr-section-check.test.ts@d648dc2c`](libs/shared/src/work/pr-section-check.test.ts#L30))

- FR-6.1: PR template with required sections: Why, What Changed,
  Alternatives Considered, ADRs & Architecture, and Testing. ([validated by `pr-template.test.ts@d8443f9a`](libs/shared/src/pr-template.test.ts#L11), [`pr-template.test.ts@ad2649ff`](libs/shared/src/pr-template.test.ts#L15), [`pr-template.test.ts@23257b79`](libs/shared/src/pr-template.test.ts#L19), [`pr-template.test.ts@0a0da2df`](libs/shared/src/pr-template.test.ts#L23), [`pr-template.test.ts@05afedc1`](libs/shared/src/pr-template.test.ts#L27), [`pr-template.test.ts@157df7ae`](libs/shared/src/pr-template.test.ts#L31))
- FR-6.2: CI check fails PRs with an empty Why or Alternatives Considered
  section. ([validated by `pr-section-check.test.ts@f06e9943`](libs/shared/src/work/pr-section-check.test.ts#L34), [`pr-section-check.test.ts@f10c7c56`](libs/shared/src/work/pr-section-check.test.ts#L44), [`pr-section-check.test.ts@d2df612b`](libs/shared/src/work/pr-section-check.test.ts#L55), [`pr-section-check.test.ts@91074177`](libs/shared/src/work/pr-section-check.test.ts#L67), [`pr-section-check.test.ts@043c8667`](libs/shared/src/work/pr-section-check.test.ts#L78), [`pr-section-check.test.ts@5b7d673b`](libs/shared/src/work/pr-section-check.test.ts#L92), [`pr-section-check.test.ts@eafe2767`](libs/shared/src/work/pr-section-check.test.ts#L101), [`pr-section-check.test.ts@d302cbab`](libs/shared/src/work/pr-section-check.test.ts#L107), [`pr-section-check.test.ts@97d5d1bb`](libs/shared/src/work/pr-section-check.test.ts#L111))
- Decision: PR-quality enforcement starts in warning-only mode; the platform
  team flips it to hard-fail via a configuration flag in the CI workflow —
  there is no automatic date-based cutoff.

### FR-7: Ingestion Pipeline (Phase 1)

The system MUST ingest content from multiple sources into the vector
store via the Lore Agent service. ([validated by `content-classify.test.ts@37ea917d`](libs/shared/src/domain/content-classify.test.ts#L5))

- FR-7.1: Fast path: on-push to main triggers incremental ingestion
  via pipeline task. ([validated by `ingest-workflow.test.ts@bce50cd7`](libs/shared/src/work/ingest-workflow.test.ts#L22))
- Decision: the nightly full re-index was retired on 2026-09-08 (ADR-019 amendment) and the job runner that could dispatch one went with Lore's own Floor on 2026-10-02; merge-time CI ingest is the only ingestion path, so a file no merge has touched since onboarding stays unindexed until one does
- FR-7.3: Content types: code (AST-split), pull requests (diff +
  description + comments), ADRs, docs (section-chunked), specs,
  runbooks. ([validated by `chunker.test.ts@5b57e26c`](libs/shared/src/work/chunker.test.ts#L6), [`chunker.test.ts@b913e390`](libs/shared/src/work/chunker.test.ts#L172), [`content-classify.test.ts@7377a917`](libs/shared/src/domain/content-classify.test.ts#L11))
- FR-7.4: Secret and credential redaction runs at ingest time via
  `redactSecrets()`; matched secrets are stripped before content is
  embedded and made searchable. ([validated by `redact.test.ts@17019aa0`](libs/shared/src/lib/redact.test.ts#L5), [`redact.test.ts@ba68e074`](libs/shared/src/lib/redact.test.ts#L30))

### FR-8: Observability (Phase 1)

The system MUST provide observability into context retrieval quality. ([validated by `otel.test.ts@8acbc43d`](libs/server-core/src/outbound/otel.test.ts#L6), [`my-usage.test.ts@74fbbf01`](apps/mcp-server/src/transport/tools/usage/my-usage.test.ts#L23))

- Decision: all MCP retrieval calls are traced via OpenTelemetry spans
  exported to Cloud Monitoring (SDK-level instrumentation).
- FR-8.2: Low-confidence retrievals (score < threshold) tagged as
  gap candidates via OTEL span attributes and Cloud Monitoring
  custom metrics. ([validated by `otel.test.ts@8acbc43d`](libs/server-core/src/outbound/otel.test.ts#L6), [`otel.test.ts@4934a71b`](libs/server-core/src/outbound/otel.test.ts#L10), [`otel.test.ts@f8ce58cd`](libs/server-core/src/outbound/otel.test.ts#L14))
- See ADR-010 for the autoresearch loop that consumed the low-confidence
  gap signal: it was deleted with Lore's own Floor on 2026-10-02, and the
  signal itself is still recorded.
- FR-8.4: `lore_my_usage` tool exposes per-developer token consumption
  (today / 7-day / 30-day) without leaving Claude Code. ([validated by returns the usage of the resolved agent read from /api/usage as pretty JSON @74fbbf01](apps/mcp-server/src/transport/tools/usage/my-usage.test.ts#L23), [`usage-pg.test.ts@083079af`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L173))

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
  so no PR could open. ([validated by lets a draft that finds the context already current report changes_requested, so a true no-op ends the run without a PR instead of failing an empty branch @f5887e6f](libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts#L730), [validated by counts gap-fill as delivering, since validate and push after it are other pods (17 of 36 gap-fill branches shipped 0 commits between 2026-08-15 and 2026-09-25) @d62a70bc](libs/shared/src/domain/task-types/delivering-recipes.test.ts#L13))

### FR-11: Live Knowledge Graph (Phase 1+)

The system MUST support traversable knowledge via a PostgreSQL-backed
live knowledge graph. ([validated by `graph.test.ts@db95a496`](libs/server-core/src/work/memory/graph.test.ts#L5))

- FR-11.1: Knowledge graph stored in `memory.entities` and
  `memory.edges` tables in PostgreSQL. Updated incrementally on
  every `lore_write_episode` call via the Lore Agent fact extractor. ([validated by `graph.test.ts@f351fd8b`](libs/server-core/src/work/memory/graph.test.ts#L91))
- FR-11.2: Entity types: Service, Team, Function, PR, ADR, Spec,
  Concept, Runbook. Typed relationships: OWNS, CALLS, IMPLEMENTS,
  SUPERSEDES, REFERENCES, AUTHORED_BY, DEFINES. ([validated by `graph.test.ts@db95a496`](libs/server-core/src/work/memory/graph.test.ts#L5), [`graph.test.ts@2eb35ad8`](libs/server-core/src/work/memory/graph.test.ts#L73))
- FR-11.3: `lore_query_graph(query)` MCP tool traverses the live graph
  for multi-hop relationship results. ([validated by proxies to GET /api/graph with the query params and bearer token @5aee62f9](apps/mcp-server/src/transport/tools/graph/query-graph.test.ts#L23))
- FR-11.4: Facts carry temporal validity (`valid_from`/`valid_to`),
  confidence tiers (`verified` / `observed` / `inferred` / `stale`),
  and retrieval metadata (`retrieval_count`, `last_retrieved_at`,
  `half_life_days`). ([validated by `facts.test.ts@0edc2ae7`](libs/server-core/src/work/memory/facts.test.ts#L71), [`memory-ranking.test.ts@403ba463`](libs/shared/src/domain/memory-ranking.test.ts#L251))
- FR-11.5: Contradiction detection: when a new fact has cosine
  similarity ≥ 0.92 to an existing one, the old fact is invalidated
  and a conflict record written to `memory.fact_conflicts`. Context
  assembly prefixes `[CONFLICT]` on facts with recent (7-day)
  conflicts. ([validated by `facts.test.ts@0edc2ae7`](libs/server-core/src/work/memory/facts.test.ts#L71), [`facts.test.ts@d17f26f9`](libs/server-core/src/work/memory/facts.test.ts#L104))

### FR-12: Intelligent Memory Lifecycle (Phase 1)

The system MUST manage agent memory automatically without agent
cooperation. ([validated by `session-tracker.test.ts@f4a2d93b`](libs/server-core/src/outbound/session-tracker.test.ts#L123))

- FR-12.1: MCP server tracks all tool calls in a 500-entry ring
  buffer (`session-tracker.ts`). On exit, dumps to
  `~/.lore/last-session.json`. Stop hook POSTs to
  `/api/session-summary` for automatic episode + fact extraction. ([validated by `session-tracker.test.ts@f4a2d93b`](libs/server-core/src/outbound/session-tracker.test.ts#L123), [`session-tracker.test.ts@b880982e`](libs/server-core/src/outbound/session-tracker.test.ts#L15))
- FR-12.2: Daily job at 5 AM scores memories 0-10 using half-life
  decay (`strength = 0.5^(age / half_life_days)`). Evicts
  lowest-scoring memories when agent exceeds 500 entries. Cleans
  invalidated facts older than 30 days beyond the 2000 cap. ([validated by `memory-ranking.test.ts@6fc4a5f0`](libs/shared/src/domain/memory-ranking.test.ts#L232))
- FR-12.3: Daily job at 5:30 AM groups recent facts (7-day lookback)
  by repo and calls Haiku to extract 1-3 higher-level patterns per
  repo. Stored as `consolidated/{repo}/{timestamp}` memories.
  Minimum 5 facts required to trigger consolidation. ([validated by `memory-lifecycle.test.ts@588332ee`](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L108), [`memory-lifecycle.test.ts@07c0ec51`](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L207))
- FR-12.4: Every `lore_search_memory` call asynchronously increments
  `retrieval_count`, updates `last_retrieved_at`, and extends
  `half_life_days` (+2, cap 365) on returned facts. Stale facts
  revive to `observed` on retrieval. Fire-and-forget — adds zero
  latency to search. ([validated by `memory-lifecycle.test.ts@5145bf5c`](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L223), [`memory-lifecycle.test.ts@4d595ada`](libs/shared/src/outbound/project/memory/memory-lifecycle.test.ts#L197))
- FR-12.5: After every pipeline task completion (PR, no-changes,
  failure), an episode is automatically written. For high-signal
  events (PRs, failures), Haiku extracts a lesson and stores it
  as `auto-curation/{ref}` memory. ([validated by `episode-writer.test.ts@f19604b8`](libs/shared/src/work/episode-writer.test.ts#L89))

### FR-13: Autonomous Review Loop (Phase 1, opt-in)

The system MUST support an opt-in, webhook-driven autonomous review loop per
repo with a safety-net cron (ADR-015; the review agent runs on the
ai-agent-subsystem per ADR-031). ([validated by starts code-review when a pull request opens in a repository with auto_review on @d7a570b7](apps/stations/src/events/floor-review-handlers.test.ts#L105), [validated by asks the floor nothing when auto_review is off @27926309](apps/stations/src/events/floor-review-handlers.test.ts#L113))

- FR-13.1: After an implementation PR is created, an auto-review is started on
  the ai-agent-subsystem when `auto_review` is enabled on the repo (ADR-031
  retired the loretask-watcher). ([validated by `auto-review-enabled.test.ts@79259980`](libs/shared/src/domain/loops/auto-review-enabled.test.ts#L5), [[starts code-review when a pull request opens in a repository with auto_review on @d7a570b7](apps/stations/src/events/floor-review-handlers.test.ts#L105), [starts code-review for a pull request no review has run on @7e10d821](libs/shared/src/work/review/floor-review-start.test.ts#L317))
- FR-13.2: The review agent reads spec + conventions and the `post-review`
  station posts ONE formal PR review — inline comments per finding plus a summary, carrying the verdict as its
  GitHub review event (`APPROVE` / `REQUEST_CHANGES`, always on, no longer a neutral comment). ([validated by posts one REQUEST_CHANGES review with a rendered comment per commentable finding @03291bb6](apps/stations/src/code-review/post-review/post-review.test.ts#L94), [validated by submits an APPROVE review carrying the inline findings for an approved verdict @f23ff95d](apps/stations/src/code-review/post-review/post-review.test.ts#L250))
- FR-13.3: On a formal `APPROVE` the PR becomes eligible for (auto-)merge once the
  remaining gates pass; auto-merge reads the bot's latest review, so a later push's re-check verdict supersedes the earlier one. ([validated by posts a visible APPROVE review for a bare REVIEW_RESULT:APPROVED with no findings block @46441fd1](apps/stations/src/code-review/post-review/post-review.test.ts#L282))
- FR-13.4: When changes are requested, a follow-up round is started on the same
  branch carrying the feedback (the code-review-reply path). ([validated by starts code-review-reply for review 99 with the repository, the pull request and the review, and no intent: the agent reads what each comment asks @9e2ce82e](libs/shared/src/work/review/floor-review-start.test.ts#L536), [validated by starts code-review-reply for a MEMBER's request-changes review 99 @0cf497f4](apps/stations/src/events/floor-review-handlers.test.ts#L170))
- FR-13.5: *(Restated 2026-10-01.)* Nothing files a `needs-human-help` Issue any more: the escalation line that did was deleted (#2330) having never run in production. Where the implementation loop owns the pull request, review threads left unresolved park its ticket with a comment that names why; elsewhere a person reads the review on the pull request. ([validated by labels issue 7 blocked and comments when await-pr ended on unresolved threads @5da5db1d](apps/stations/src/code-review/run-settled/loop-closed.test.ts#L285), [validated by labels lore:blocked and comments when await-pr resumed failed @2ee15949](libs/shared/src/work/backlog/loop-run-closed.test.ts#L300))
- FR-13.6: The primary trigger is GitHub webhooks (ADR-015): the stations
  service turns qualifying `pull_request`, `pull_request_review`, and PR
  `issue_comment` events into calls that start or reply on a code-review
  pipeline of the external floor (`apps/stations/src/events/floor-review-handlers.ts`);
  bot-authored events are skipped as a loop guard. ([validated by starts code-review when a pull request opens in a repository with auto_review on @d7a570b7](apps/stations/src/events/floor-review-handlers.test.ts#L105), [validated by starts nothing when the lore bot comments @lore review @e9774299](apps/stations/src/events/floor-review-handlers.test.ts#L159), [validated by starts no reply for a review the lore bot submitted @ba9bd0bc](libs/shared/src/work/review/floor-review-start.test.ts#L554))
- FR-13.7: **Safety-net cron** fires at `7 7-17 * * 1-5` (UTC,
  Mon-Fri) to catch dropped webhook deliveries. Cron-triggered runs
  are gated by `isBusinessHours()` (default: Europe/Berlin, 09:00-18:00
  Mon-Fri via `LORE_BUSINESS_HOURS_{TZ,START,END,DAYS}` env vars).
  Webhook-triggered runs are never gated by business hours. ([validated by `business-hours.test.ts@f8f04b0a`](libs/shared/src/lib/business-hours.test.ts#L37))
- Decision: the webhook trigger degrades gracefully when its ingress env is
  absent — a warning is logged and the safety-net cron (FR-13.7) covers the gap.

### FR-14: Spec Drift Detection (Phase 2)

The system MUST detect when specifications diverge from implementation. ([validated by reads a repo's code symbols from its team schema @7c140354](libs/shared/src/outbound/project/chunks/chunks.test.ts#L197), [`chunks.test.ts@c317c378`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L226))

- FR-14.1: *(Since 2026-10-02.)* A weekly line reads each spec's statements from the traceability graph and
  finds those whose bound test fails. It is the `spec-upkeep` line on the external floor (`specs/external-floor` FR14); the per-repo `spec-drift` fan-out on Lore's own Floor that did this before is gone. ([validated by finds the statement of specs/cart/spec.md whose bound test fails, with its section and the test @635a84e6](libs/shared/src/work/spec-upkeep/findings.test.ts#L65))
- Decision: divergence above 20% of a spec's assertions triggers a `gap-fill`
  pipeline task for the owning team.
- FR-14.3: Test files and generated files are excluded. ([validated by `chunks.test.ts@45447b7a`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L713), [`chunks.test.ts@2a8ab318`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L739))
- FR-14.4: Spec-drift reads a repo's spec chunks and code symbols from
  the repo's resolved schema (team schema when provisioned, `org_shared`
  otherwise) — the same schema the reindex job wrote them to. The
  `codeSymbols` read excludes `symbol_type = 'call'` chunks, so a test
  file's `describe` title can never satisfy the drift heuristic's
  known-symbol check for a deleted declaration.
  ([validated by `chunks.test.ts@2fc1ae53`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L167), [`chunks.test.ts@8caa545d`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L178), [`chunks.test.ts@7c140354`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L197), [`chunks.test.ts@c317c378`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L226), [`chunks.test.ts@45447b7a`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L713), [`chunks.test.ts@2a8ab318`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L739))

### FR-15: Progressive Trust (Phase 1)

The system MUST gate task types per-repo based on demonstrated
reliability. ([validated by `pipeline-tasks.trust.test.ts@4ac792dc`](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L33))

- FR-15.1: *(rewritten 2026-10-07)* `settings.trust.level` controls which task types are
  allowed: `docs` (gap-fill/runbook/onboard + feature-planning
  per ADR-027), `tests` (+review),
  `implementation` (+implementation-loop/feature-request),
  `full` (all). `onboard` is allowed at every tier — it produces a
  docs-only scaffolding PR and duplicate protection lives in its own
  route's guard, not the trust ladder. `spec-task` is in no tier: it was listed at
  `implementation` and `full` from 2026-09-29, and the type is refused outright now
  that nothing runs one, so trust is never consulted for it.
  ([validated by `allows an onboard task at trust level %s` @4ac792dc](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L33), [validated by refuses an implementation-loop task at trust level docs @cd8ff1a0](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L48), [validated by refuses a spec-task at trust level %s, pointing at the backlog loop @4ac792dc](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L163))
- FR-15.2: Trust auto-promotes after 3 successful merges at the current level
  (overridable per repo via `auto_promote_threshold`), climbing
  `docs → tests → implementation → full` and resetting the merge counter on
  each promotion. A repo already at `full`, or carrying no level at all, is
  left untouched rather than banking a counter with nothing to spend it on.
  The default level is `implementation` for backward compatibility. An
  unrecognised level demotes to the lowest rung rather than throwing or
  inventing an out-of-range index. ([validated by `trust-ladder.test.ts@d06517ed`](apps/stations/src/work/lib/trust-ladder.test.ts#L5), [`trust-ladder.test.ts@0a8a7f72`](apps/stations/src/work/lib/trust-ladder.test.ts#L14), [`trust-ladder.test.ts@857a8674`](apps/stations/src/work/lib/trust-ladder.test.ts#L23), [`trust-ladder.test.ts@8b7b2e1a`](apps/stations/src/work/lib/trust-ladder.test.ts#L38), [`trust-ladder.test.ts@5fb35f9d`](apps/stations/src/work/lib/trust-ladder.test.ts#L47), [`trust-ladder.test.ts@36508e60`](apps/stations/src/work/lib/trust-ladder.test.ts#L65), [`demotes to the lowest rung rather than inventing an index for an unrecognised level` @7cbb547d](apps/stations/src/work/lib/trust-ladder.test.ts#L56))

### FR-16: Prompt Caching on Agent LLM Calls (Phase 1)

The system MUST cache repeated LLM prefixes on all agent-side Anthropic
API calls to reduce token cost (ADR-015, added 2026-04-17). ([validated by `prompt-cache.test.ts@e7c2ee70`](libs/shared/src/outbound/llm/prompt-cache.test.ts#L87))

- FR-16.1: `libs/shared/src/outbound/llm/anthropic-provider.ts` places two cache
  breakpoints per request — one on the system prompt block
  (`buildCacheableSystem`), one on the tool schema block
  (`buildCacheableTools`) — so a tool-schema edit cannot bust the system
  cache and vice versa. ([validated by `anthropic-provider.test.ts@d1fdcec2`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L9), [`anthropic-provider.test.ts@6af0fce1`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L32), [`anthropic-provider.test.ts@9102efd5`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L48))
- FR-16.2: `getCacheControl(jobName)` from `agent/src/lib/prompt-cache.ts`
  returns `{type: "ephemeral", ttl: "1h"}` for jobs in the
  `LORE_CACHE_1H_JOBS` allowlist and `{type: "ephemeral"}` (5-min)
  otherwise. Default allowlist: `auto-curation`, `review_reactor`,
  `fact-extraction`, `graph-extraction`. Special values: `none`
  disables 1h everywhere; `*` enables it for every job. ([validated by `prompt-cache.test.ts@e7c2ee70`](libs/shared/src/outbound/llm/prompt-cache.test.ts#L87), [`anthropic-provider.test.ts@2985b955`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L21))
- Decision: cache eligibility is latched at module load to prevent
  mid-process toggles from busting the server-side cache.
- FR-16.4: Each call computes a djb2 hash of the system + tools prefix
  and compares to the last call for the same `jobName`. Log line
  emits: `cache hit | first-call | break:system | break:tools |
break:ttl(Nm)`. ([validated by `prompt-cache.test.ts@868682dc`](libs/shared/src/outbound/llm/prompt-cache.test.ts#L117), [`prompt-cache.test.ts@1a3206c4`](libs/shared/src/outbound/llm/prompt-cache.test.ts#L123))
- FR-16.5: `response.usage.cache_creation_input_tokens` and
  `cache_read_input_tokens` feed cost accounting (1.25× writes,
  0.1× reads). ([validated by `anthropic-provider.test.ts@cc817e7f`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L74), [`anthropic-provider.test.ts@ddecd2b9`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L101), [`anthropic-provider.test.ts@f1505d83`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L128))
- Decision: MCP-server raw fetch call sites (fact extraction, graph
  extraction) have static prefixes below Haiku's 2048-token cache
  minimum — caching is not applied there.
- FR-16.6: `computeCost(model, ...)` prices a call at that model's own
  per-1M-token rate rather than a single flat rate, so a Sonnet or Opus
  call is not silently billed at Haiku's price; an unrecognized model
  falls back to the Haiku-tier rate rather than throwing. Every model
  offered in the agent-definitions `KNOWN_MODELS` picker has its own
  `MODEL_PRICING` entry, so none of them silently falls back. ([validated by `anthropic-provider.test.ts@91a74881`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L139), [`anthropic-provider.test.ts@445f5e81`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L158), [`anthropic-provider.test.ts@2a570df2`](libs/shared/src/outbound/llm/anthropic-provider.test.ts#L177))

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
non-terminal states and resolve them without manual intervention. ([validated by `task-queue.test.ts@b4043595`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L103))

- FR-18.1: A `stale_task_check` job runs hourly at `:17` and flags
  tasks in `running` or `pending` state for longer than their
  configured timeout plus a grace period. ([validated by `task-queue.test.ts@b4043595`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L103))
- FR-18.2: Stuck tasks are transitioned to a terminal state
  (`failed` with reason `timeout_exceeded`) so the pipeline does not
  stall waiting for a pod that has already exited. ([validated by `task-queue.test.ts@b4043595`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L103))
- FR-18.3: The transition is idempotent — if a task completes between
  detection and the state write, the write is a no-op. ([validated by `task-store-pg.test.ts@3d192b47`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L68))
- FR-18.4: A failure episode is written for each stuck task so the
  auto-curation pipeline can surface patterns (e.g. a task type that
  consistently times out). ([validated by `episode-writer.test.ts@f19604b8`](libs/shared/src/work/episode-writer.test.ts#L89), [`episode-writer.test.ts@3b62a51e`](libs/shared/src/work/episode-writer.test.ts#L13))

### FR-19: Task Detail UI (Phase 1)

_(Rewritten 2026-10-05.)_ A task has no page of its own: the run detail
page at `/assembly-runs/[id]` is where a task is read, and the
`/tasks/[id]` lifecycle shell, which only forwarded to a run Postgres
held and so opened empty for a task whose run is on the external floor,
is deleted. ([validated by links to no task page @3943c8fd](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L114))

- FR-19.1: `/assembly-runs/<id>` given a task id redirects to the task's
  newest run, so every link that knows only a task (a repository's recent
  tasks, the backlog's onboarding banner, the bounce after a cancel) points
  there. lore-api's `GET /api/assembly-runs?task_id=` answers the run from
  Postgres when it holds one and from the external floor otherwise. ([validated by returns the floor's run for a task Postgres holds no run of @dce141a9](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L187))
- FR-19.2: A task nothing ran for says so: the heading "This task has no
  run", its sentence-cased status badge, its failure reason when it has
  one, and a link to its repository. ([validated by says the failed task has no run and why it failed @8fc1bf6f](apps/web-ui/src/app/assembly-runs/[id]/TaskWithoutRun.test.tsx#L9), [validated by links the task's repository @23390012](apps/web-ui/src/app/assembly-runs/[id]/TaskWithoutRun.test.tsx#L23), [validated by shows no reason for a task that has none @d5266875](apps/web-ui/src/app/assembly-runs/[id]/TaskWithoutRun.test.tsx#L32))
- FR-19.4: The run header offers "Cancel Task" while the run is open and
  has a task, and not on a finished run or a run with no task; the
  confirm-gated `CancelTaskButton` shows only its trigger until clicked,
  then reveals a form posting to `/api/tasks/<id>/cancel` that "Keep
  task" backs out of. There is no "Run Now": no task is created pending. ([validated by offers to cancel the task of a running run @c10ac6f6](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L68), [validated by offers no cancel on %s @3d978760](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L79), [`CancelTaskButton.test.tsx@d2b61eca`](apps/web-ui/src/app/assembly-runs/[id]/CancelTaskButton.test.tsx#L7), [`CancelTaskButton.test.tsx@14ac15dd`](apps/web-ui/src/app/assembly-runs/[id]/CancelTaskButton.test.tsx#L17), [`CancelTaskButton.test.tsx@b2feae1f`](apps/web-ui/src/app/assembly-runs/[id]/CancelTaskButton.test.tsx#L30))
- FR-19.6: _(Restated 2026-09-09.)_ The run detail page renders the task's status transitions inside the selected node's transcript rather than as a separate Event Timeline card: each transition that fell inside that node's visits reads as a `· task From → To` system line in the conversation, with its metadata folded behind the line and the from-status omitted on the first transition; a run with no backing task shows the note that no status history is available. ([validated by `transcript-entries.test.ts@33d0d6ba`](apps/web-ui/src/lib/transcript-entries.test.ts#L117), [`transcript-entries.test.ts@a4127a0e`](apps/web-ui/src/lib/transcript-entries.test.ts#L142), [`TranscriptView.test.tsx:56`](apps/web-ui/src/app/assembly-runs/[id]/TranscriptView.test.tsx#L56), [adds a task transition the stream reports to the selected node's transcript @706fd2d8](apps/web-ui/src/app/assembly-runs/[id]/RunLiveShell.test.tsx#L166))
- FR-19.7: The run detail page renders the task's LLM-call table: one
  row per call with the model, `input / output` token counts, duration,
  and a status badge (red with the error text on failure), and an
  empty-state note in place of the table when there are none; the section
  is a collapsible card titled LLM Calls. ([validated by `LlmCallsTable.test.tsx@1c4e66ee`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L25), [`LlmCallsTable.test.tsx@29ffcb03`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L33), [`LlmCallsTable.test.tsx@97943881`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L41), [`LlmCallsTable.test.tsx@fb5bdd20`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L19), [`LlmCallsTable.test.tsx@73cfe8d6`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L53), [`LlmCallsTable.test.tsx@4539142a`](apps/web-ui/src/app/assembly-runs/[id]/LlmCallsTable.test.tsx#L65))
- FR-19.16: The two task transitions the UI offers are shared seams in
  `libs/shared`, not route-local SQL. `escalateTask` (run-now) refuses an
  unknown id and anything past `pending`, sets `priority = 'immediate'`,
  and records the transition carrying the priority it replaced.
  `cancelTask` treats `completed`, `merged`, `failed` and `cancelled` as
  terminal — `completed` was missing, so the web UI's own guard refused
  a click the API accepted. ([validated by `sets priority immediate on a pending task` @4cc5933c](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L20), [`pipeline-tasks.escalate.test.ts@4a587be0`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L34), [`pipeline-tasks.escalate.test.ts@d491bc2c`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L51), [`pipeline-tasks.escalate.test.ts@88c961dc`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L59), [`pipeline-tasks.escalate.test.ts@5624eaff`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L69), [`pipeline-tasks.escalate.test.ts@3ee98195`](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L80))

- FR-19.17: lore-api serves one `lore.repos` row at
  `GET /api/repos/{owner}/{repo}` under the `read` scope, reading it
  through the Project facade for the repo in the path, 404 for a repo
  with no row and 500 for a failed lookup. It returns the record WHOLE
  rather than a per-caller projection: nine web-ui call sites across
  five files each selected a different column subset of this row, and
  projecting per caller would move that duplication into the API
  instead of removing it. ([validated by `repo-record.test.ts@481cb385`](apps/lore-api/src/transport/routes/repos/repo-record.test.ts#L66), [`repo-record.test.ts@ec6ff556`](apps/lore-api/src/transport/routes/repos/repo-record.test.ts#L75), [`repo-record.test.ts@7ed06644`](apps/lore-api/src/transport/routes/repos/repo-record.test.ts#L83), [`repo-record.test.ts@4e8a6c44`](apps/lore-api/src/transport/routes/repos/repo-record.test.ts#L92))
- FR-19.18: `SettingsPort.record(repo)` is that read — the whole row or
  null — implemented by the Pg adapter against `lore.repos` and by the
  in-memory double over its seeded rows, so a caller that needs more
  than `rawSettings` or `team` has one place to get it. ([validated by returns the seeded row as the camelCase model @ee038576](libs/shared/src/outbound/project/settings/settings-record.test.ts#L44), [`settings-record.test.ts@2d7ac3db`](libs/shared/src/outbound/project/settings/settings-record.test.ts#L55), [`settings-record.test.ts@29c657fe`](libs/shared/src/outbound/project/settings/settings-record.test.ts#L71), [`settings-record.test.ts@409e72b5`](libs/shared/src/outbound/project/settings/settings-record.test.ts#L89), [`settings-record.test.ts@edeea26d`](libs/shared/src/outbound/project/settings/settings-record.test.ts#L101))

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
  moment the card showing the number disappears. ([validated by `assembly-lines.test.ts@254c21f5`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L87), [`assembly-lines.test.ts@ad0efde4`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L91), [`assembly-lines.test.ts@6012587a`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L107), [`assembly-lines.test.ts@a237a575`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L154), [`assembly-lines.test.ts@5ca114ff`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L170), [`assembly-lines.test.ts@bc47df0a`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L243), [`assembly-lines.test.ts@c51dbe7f`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L496), [`assembly-lines.test.ts@32e266d1`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L509), [`assembly-lines.test.ts@b8276314`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L517), [`assembly-lines.test.ts@96130886`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L529), [`assembly-lines.test.ts@bc47df0a`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L243), [`assembly-lines.test.ts@8392eb57`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L589), [`assembly-lines.test.ts@466910b0`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L607), [`assembly-lines.test.ts@a78442be`](apps/lore-api/src/transport/routes/assembly-lines/assembly-lines.test.ts#L617))

- FR-19.20: lore-api serves the activity reads the audit, gaps, events,
  job-run and repo-overview views need, all under the `read` scope:
  `GET /api/memory-audit` (agent / operation filters plus a
  `zero_results` lens for the gap view, answering a page AND the unpaged
  total the pager needs), `GET /api/events` (repo-scoped, newest first,
  repo required), `GET /api/job-runs/{id}`, and
  `GET /api/repos/{owner}/{repo}/activity-counts` (7-day tasks,
  auto-merges and escalations). A count the database cannot answer is
  NULL, never zero: an unmigrated cluster must not render as "nothing
  happened", and no dashboard figure may take its page down. ([validated by `activity.test.ts@254c21f5`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L31), [`activity.test.ts@27688ea3`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L35), [`activity.test.ts@69cee1fb`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L49), [`activity.test.ts@0a7e8096`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L60), [`activity.test.ts@0e1b7002`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L70), [`activity.test.ts@18f12f53`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L83), [`activity.test.ts@538aed2f`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L111), [`activity.test.ts@b845033b`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L115), [`activity.test.ts@c51dbe7f`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L129), [`activity.test.ts@32e266d1`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L142), [`activity.test.ts@92432704`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L152), [`activity.test.ts@dad7749f`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L162))
- The `status` an event shows on the repo page is the Floor's DELIVERY of
  it, read from `pipeline.event_deliveries`, and an event no subscriber
  ever received reads `undelivered` — `pipeline.events` itself carries no
  status (ADR-044 amendment 2026-09-09). ([validated by `activity.test.ts@a57a1323`](apps/lore-api/src/transport/routes/analytics/activity.test.ts#L94))

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
  search remains `POST /api/memory`. ([validated by `memory-browse.test.ts@254c21f5`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L31), [`memory-browse.test.ts@6459711c`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L35), [`memory-browse.test.ts@f785159b`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L51), [`memory-browse.test.ts@58736fcd`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L64), [`memory-browse.test.ts@4e1b9ed8`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L78), [`memory-browse.test.ts@4453742a`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L91), [`memory-browse.test.ts@cc1a651b`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L106), [`memory-browse.test.ts@89a12e07`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L117), [`memory-browse.test.ts@b4ef70a0`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L130), [`memory-browse.test.ts@27688ea3`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L140), [`memory-browse.test.ts@e2c48087`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L153), [`memory-browse.test.ts@be34c00c`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L164), [`memory-browse.test.ts@571cf63f`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L179), [`memory-browse.test.ts@530e01c2`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L193), [`memory-browse.test.ts@c8439177`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L222), [`memory-browse.test.ts@5a3a41bb`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L199), [`memory-browse.test.ts@25b1cb9c`](apps/lore-api/src/transport/routes/memory/memory-browse.test.ts#L234))

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
  pipeline history to Node for one dashboard row per agent. ([validated by [`task-views.test.ts@254c21f5`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L31), [`task-views.test.ts@8ea83ef7`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L37), [`task-views.test.ts@538aed2f`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L48), [`task-views.test.ts@d6d9ca38`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L52), [`task-views.test.ts@d5e9428e`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L66), [`task-views.test.ts@67be5494`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L79), [`task-views.test.ts@031e3b65`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L90), [`task-views.test.ts@6ede502b`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L102), [`task-views.test.ts@caeb2005`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L117), [`task-views.test.ts@b0e0539a`](apps/lore-api/src/transport/routes/tasks/task-views.test.ts#L135))

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
  confident zero. ([validated by [`spend.test.ts@254c21f5`](apps/lore-api/src/transport/routes/analytics/spend.test.ts#L30), [`spend.test.ts@259c902e`](apps/lore-api/src/transport/routes/analytics/spend.test.ts#L34), [`spend.test.ts@0042c2ef`](apps/lore-api/src/transport/routes/analytics/spend.test.ts#L46), [`spend-window.test.ts@7eba330f`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L198), [`spend-window.test.ts@c0c3a686`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L386), [`spend-window.test.ts@9169e0af`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L407), [`spend-window.test.ts@68ade459`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L425))

- FR-19.24: *(Rewritten 2026-10-02.)* A task is not revised by queueing another task. `POST /api/task` with `action: "revise"` answers `409` and points at a review that requests changes on the pull request, which the `code-review-reply` line answers there. The `reviseTask` seam that queued a follow-up feature-request task on the parent's branch is deleted with the last task type it ran as (`specs/external-floor` FR16.7). ([validated by queues no revision of task t1 and points at a review on its pull request @9374172b](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L175))

- FR-19.25: lore-api serves the org-wide `lore.settings` under the
  `admin` scope — `GET /api/settings` (the entries plus the repo count
  the settings page shows) and `PUT /api/settings`, whose writable keys
  are an ALLOWLIST: that table holds the ingest token and the approval
  config, so a route upserting any key a caller named would let one
  invent settings the platform then reads. A blank value leaves the
  stored one alone rather than erasing it, because the form posts every
  field and an untouched secret arrives empty.
  `GET /api/repos/{owner}/{repo}/sessions` answers how many
  developers have run a local session against a repo. ([validated by [`org-settings.test.ts@254c21f5`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L44), [`org-settings.test.ts@48571dc6`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L50), [`org-settings.test.ts@1e37b790`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L69), [`org-settings.test.ts@1e37b790`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L69), [`org-settings.test.ts@dd76085c`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L85), [`org-settings.test.ts@d8897813`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L191), [`org-settings.test.ts@d8897813`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L191), [`org-settings.test.ts@1e37b790`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L69), [`org-settings.test.ts@dd76085c`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L85), [`org-settings.test.ts@ff8f1037`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L181), [`org-settings.test.ts@d8897813`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L191), [`org-settings.test.ts@65871c78`](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L202), [`repos.test.ts@73b4e3d6`](apps/web-ui/src/lib/api/repos.test.ts#L106), [`repos.test.ts@2c5e65a7`](apps/web-ui/src/lib/api/repos.test.ts#L116))

- FR-19.25a: *(Added 2026-11-04.)* The writable keys include
  `context_llm_provider` and `context_llm_model`, the context builder's
  model, which the Settings page's **Context builder** card edits: a
  provider select (Off, Vertex, Anthropic; Vertex when nothing is
  saved) and a model field suggesting `gemini-3-flash-preview`. A provider other than `off`, `vertex` or
  `anthropic` is refused with `400` and nothing is written. ([validated by stores context_llm_provider vertex and context_llm_model gemini-3-flash-preview @e29456ae](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L138), [validated by refuses a context_llm_provider of ollama and writes nothing @2966c5f7](apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L166), [validated by refuses a context_llm_provider of ollama @f72b0f72](libs/shared/src/domain/context-model.test.ts#L57), [validated by accepts vertex and a blank provider, and leaves every other key alone @0345ef8c](libs/shared/src/domain/context-model.test.ts#L63), [validated by shows the saved vertex provider and gemini-3-flash-preview model @cbe3b940](apps/web-ui/src/app/settings/ContextModelForm.test.tsx#L7), [validated by offers off, vertex and anthropic as providers, with vertex selected when nothing is saved @3403fee9](apps/web-ui/src/app/settings/ContextModelForm.test.tsx#L22))

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
  ([validated by [`chunks-browse.test.ts@254c21f5`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L55), [`chunks-browse.test.ts@553c497c`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L59), [`chunks-browse.test.ts@e4209c63`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L76), [`chunks-browse.test.ts@758116a2`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L88), [`chunks-browse.test.ts@030679c7`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L101), [`chunks-browse.test.ts@ad1bf075`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L115), [`chunks-browse.test.ts@85fcade6`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L129), [`chunks-browse.test.ts@b6d4248d`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L153), [`chunks-browse.test.ts@a08f8167`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L181), [`chunks-browse.test.ts@3d388651`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L203), [`chunks-browse.test.ts@13401731`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L234), [`chunks-browse.test.ts@13401731`](apps/lore-api/src/transport/routes/context/chunks-browse.test.ts#L234))

- FR-19.27: Retired 2026-09-09. The operator-recorded Anthropic credit
  balance is gone: `POST /api/spend/credits` no longer exists and
  `GET /api/analytics/spend-window` carries no `budget` block, so the spend
  screen reads nothing a person typed in. Anthropic's Admin API still exposes
  no credit balance, so what is LEFT stays unfetchable by construction — the
  page reports what was spent, not what remains. The `pipeline.credit_ledger`
  table (migration 0045) is dropped by migration 0080. ([validated by carries no budget block and never reads a credit ledger @48021ed6](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L343))

- FR-19.28: Retired 2026-09-09 with FR-19.27. `/spend` renders no balance
  section, credits card, or top-up form, and with them went the page's one
  em dash placeholder: every figure left is Lore-computed or vendor-billed, so
  the page is complete on Lore data alone. ([validated by carries no balance section, credits card or top-up form @bd21ce0a](apps/web-ui/src/app/spend/SpendView.test.tsx#L195), [`SpendView.test.tsx@51d23855`](apps/web-ui/src/app/spend/SpendView.test.tsx#L336))

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
  ([validated by windows the metered llm spend and prices pod-hours at the assumed profile @980eec5d](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L167), [`spend-window.test.ts@5dc2ba57`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L460), [`SpendView.test.tsx@566dcc08`](apps/web-ui/src/app/spend/SpendView.test.tsx#L457), [`SpendView.test.tsx@ead48c1a`](apps/web-ui/src/app/spend/SpendView.test.tsx#L449), [`spend-window.test.ts@8a487a51`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L584)])

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
  ([validated by windows the metered llm spend and prices pod-hours at the assumed profile @980eec5d](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L167), [`spend-window.test.ts@6ff34540`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L353), [caps a never-finished station-run row at 2 hours @0a8b007e](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L373), [carries every interval-scoped breakdown the merged spend page renders @7eba330f](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L198), [`spend-window.test.ts@3aacf299`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L328), [`SpendView.test.tsx@6e529d02`](apps/web-ui/src/app/spend/SpendView.test.tsx#L224), [`SpendView.test.tsx@cad84e70`](apps/web-ui/src/app/spend/SpendView.test.tsx#L229), [`compute-cost.test.ts@d0fe5659`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L12), [`compute-cost.test.ts@3bde7911`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L25), [`compute-cost.test.ts@ecb6a1e4`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L34), [`compute-cost.test.ts@c4b1cd9a`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L40), [`compute-cost.test.ts@66a34514`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L47), [`compute-cost.test.ts@90953e9d`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L56), [`compute-cost.test.ts@624c0bf2`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L65), [`compute-cost.test.ts@c2a29493`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L75), [`compute-cost.test.ts@96d16809`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L82), [`compute-cost.test.ts@2a5f5e7b`](apps/lore-api/src/work/analytics/compute-cost.test.ts#L89), [fetches the default 7-day window and renders the whole spend view from it @05c2c799](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L104), [`SpendWindowPanel.test.tsx@ca47d328`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L127), [`SpendWindowPanel.test.tsx@5c1ad5c3`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L142), [`SpendWindowPanel.test.tsx@0a506b89`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L158), [`SpendWindowPanel.test.tsx@ee98313d`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L179), [`spend-window-presets.test.ts@c199335c`](apps/web-ui/src/app/spend/spend-window-presets.test.ts#L7), [`spend-window-presets.test.ts@b60b148a`](apps/web-ui/src/app/spend/spend-window-presets.test.ts#L14), [`spend-window-presets.test.ts@0c4fcd30`](apps/web-ui/src/app/spend/spend-window-presets.test.ts#L25), [`spend-window-presets.test.ts@85577474`](apps/web-ui/src/app/spend/spend-window-presets.test.ts#L34), [`SpendWindowPanel.test.tsx@66c10d24`](apps/web-ui/src/app/spend/SpendWindowPanel.test.tsx#L195)])

- **FR-19f.1 — Spend figures read the same everywhere** _(added 2026-10-20)_.
  The web UI renders spend figures and token counts in en-US whatever the
  server's or the reader's locale, so the server render and the browser
  agree. ([validated by formats money and counts in en-US whatever the machine's locale @559cb3c9](apps/web-ui/src/app/spend/spend-format.test.ts#L5))

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
  ([validated by [`spend-window.test.ts@f3bcffcd`](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L445), [`vendor-split.test.ts@e818d766`](apps/lore-api/src/work/analytics/vendor-split.test.ts#L5), [`vendor-split.test.ts@50710d54`](apps/lore-api/src/work/analytics/vendor-split.test.ts#L19), [`vendor-split.test.ts@eb09edfc`](apps/lore-api/src/work/analytics/vendor-split.test.ts#L25), [`model-vendor.test.ts@ff43728b`](libs/shared/src/outbound/llm/model-vendor.test.ts#L5), [`model-vendor.test.ts@f19d0b92`](libs/shared/src/outbound/llm/model-vendor.test.ts#L17), [`model-vendor.test.ts@3422021c`](libs/shared/src/outbound/llm/model-vendor.test.ts#L21), [`model-vendor.test.ts@01fee088`](libs/shared/src/outbound/llm/model-vendor.test.ts#L11), [`model-vendor.test.ts@b0ae5638`](libs/shared/src/outbound/llm/model-vendor.test.ts#L25), [`model-vendor.test.ts@bd40fd10`](libs/shared/src/outbound/llm/model-vendor.test.ts#L31), [`SpendView.test.tsx@2eea7107`](apps/web-ui/src/app/spend/SpendView.test.tsx#L471), [`SpendView.test.tsx@18d50242`](apps/web-ui/src/app/spend/SpendView.test.tsx#L478), [`SpendView.test.tsx@bac96c81`](apps/web-ui/src/app/spend/SpendView.test.tsx#L491))

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
  Anthropic row, falling back to the metered total only when there is no split — and a Billing Source split
  of the spend by the credential that paid for it: Lore's own model calls
  (`pipeline.llm_calls`) on the org API key, plus the external floor's agent
  visits grouped by `billing_mode` (`floor.costs.summary(filter,
  "billing_mode")`, read from the `apiKeySource` on each agent's init line:
  API key, subscription, or unknown where the agent named none) — so a
  reader can see how much of the total the Anthropic invoice can even account
  for, since a subscription run bills a person's own account and never reaches
  it. A floor that cannot answer that read (down, or a version without the
  `billing_mode` group) does not fail the page: the split holds Lore's own calls
  on the org key alone, `floor_unavailable` is true, and the panel notes "Floor
  costs unavailable". The deeper LLM cuts — by model, kind, day, repo, task type and
  cluster — fold behind a disclosure, so the page opens on the two figures that
  answer the money question, cost per line and per vendor, rather than a wall of
  tables. The bar geometry is pure and scale-free: both widths are fractions
  of the larger of the pair, a pair with no spend renders flat rather than
  dividing by zero, and a comparison with no billed side is not drawn at all.
  ([validated by [groups the page into labelled estimate and billed sections @649492a1](apps/web-ui/src/app/spend/SpendView.test.tsx#L510), [`SpendView.test.tsx@63882901`](apps/web-ui/src/app/spend/SpendView.test.tsx#L536), [`SpendView.test.tsx@1c2227cf`](apps/web-ui/src/app/spend/SpendView.test.tsx#L544), [`SpendView.test.tsx@fffa9c14`](apps/web-ui/src/app/spend/SpendView.test.tsx#L547), [folds the deeper LLM breakdowns behind a disclosure @077742cd](apps/web-ui/src/app/spend/SpendView.test.tsx#L553), [labels an estimate section with an estimate pill @7bd27f57](apps/web-ui/src/app/spend/SpendSection.test.tsx#L7), [`SpendSection.test.tsx@e045202f`](apps/web-ui/src/app/spend/SpendSection.test.tsx#L25), [`SpendSection.test.tsx@7443441f`](apps/web-ui/src/app/spend/SpendSection.test.tsx#L36), [shows the label and both figures for a comparable pair @89def459](apps/web-ui/src/app/spend/SpendCompareBars.test.tsx#L13), [`SpendCompareBars.test.tsx@852216af`](apps/web-ui/src/app/spend/SpendCompareBars.test.tsx#L21), [`SpendCompareBars.test.tsx@29cd17e1`](apps/web-ui/src/app/spend/SpendCompareBars.test.tsx#L29), [`SpendCompareBars.test.tsx@29cd17e1`](apps/web-ui/src/app/spend/SpendCompareBars.test.tsx#L39), [scales both values to the larger of the two @c6dcea21](apps/web-ui/src/app/spend/spend-chart-geometry.test.ts#L5), [`spend-chart-geometry.test.ts@ea964eec`](apps/web-ui/src/app/spend/spend-chart-geometry.test.ts#L12), [takes the Anthropic vendor row when the split names one](apps/web-ui/src/app/spend/SpendView.test.tsx#L573), [is zero when the split names other vendors but no Anthropic @42ed0c52](apps/web-ui/src/app/spend/SpendView.test.tsx#L583), [`SpendView.test.tsx@491502c8`](apps/web-ui/src/app/spend/SpendView.test.tsx#L591), [shows the org API-key row with its cost @d73614c5](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L18), [shows the subscription row with its cost @1bbe960c](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L25), [shows runs whose agent named no credential as unknown @6fdfe549](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L32), [notes that the billed figure covers only the API-key portion @3ab6293e](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L39), [renders nothing when there is no spend to split @22d7f8ad](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L58), [splits billing mode into Lore's own calls on the org key plus the floor's visits by credential @55f95cb8](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L474), [counts only Lore's own calls, on the org key, when no floor is configured @4a09e343](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L536), [answers 200 with Lore's own 42 calls on the org key and floor_unavailable true when the floor rejects the billing_mode group @6bff6f77](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L544), [notes Floor costs unavailable when the floor could not answer @b90e7e09](apps/web-ui/src/app/spend/SpendBillingSource.test.tsx#L49)])

- **FR-19h.1 — Billing mode from the recorded column** _(added 2026-10-19)_.
  When `pipeline.llm_calls` carries a `billing_mode` column, the
  `/api/analytics/spend-window` billing-source split reads the recorded mode
  directly from the DB rather than attributing by floor visit or cluster. The
  note on the spend page stops describing the split as derived from
  agent-startup credentials once the per-call mode is present.
  ([validated by [splits by recorded billing_mode directly instead of inferring from cluster @a57d59b0](apps/lore-api/src/transport/routes/analytics/spend-window-billing.acceptance.test.ts#L59), [stops calling the billing source a proxy once the recorded mode is present @5b1b8c30](apps/web-ui/src/app/spend/SpendBillingSource.acceptance.test.tsx#L7), [queries billing_mode from pipeline.llm_calls and surfaces the recorded split directly @31a6b517](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L565)])

- **FR-19h.2 — Recording billing mode at dispatch** _(added 2026-10-21)_.
  `ensureStationRun` accepts a `billingMode` and persists it in `pipeline.station_runs.billing_mode`; `logLlmCall` joins to that row via the resolved `station_run_id` and writes the value into `pipeline.llm_calls.billing_mode`, so the per-call column the read path queries is populated by the write path.
  ([validated by [includes billing_mode in the llm_calls INSERT, resolved from station_runs via the carried station_run_id @f5349cae](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L202), [records the billing mode at dispatch and joins it into the cost row @ab86df66](apps/lore-api/src/integration-tests/billing-mode-write.acceptance.test.ts#L40)])

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
  five cheapest, each linked to its Issue. ([validated by sums 4 tickets to 8.25 USD with a 1 USD median, keyed by issue url, loop branch, then description @dab3f53f](apps/lore-api/src/integration-tests/spend-unit-costs.test.ts#L68), [carries what a ticket, a PR review and a node visit cost, lore issue 1648 dearest at 70.27 USD @b6870df9](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L261))

- **FR-19i.1** A PR review is keyed by repo plus `args.pr_number` and covers every
  `code-review`, `code-review-recheck` and `code-review-reply` run of that
  PR; the reviews carry the same ranked summary per PR, linked to the pull
  request, the average per run of each of the three lines, and their cost
  by model. ([validated by puts review, recheck and reply of PR 7 on one 1.50 USD PR beside PR 8 at 0.40 USD @831e32ac](apps/lore-api/src/integration-tests/spend-unit-costs.test.ts#L119))

- **FR-19i.2** Per node, each assembly line's nodes carry their visits (one
  `station_runs` row each, reached through `llm_calls.station_run_id`),
  total, cost per visit and the models that ran them. ([validated by counts tdd-round as 2 visits at 2 USD each on two models, per assembly line @5c9f6d73](apps/lore-api/src/integration-tests/spend-unit-costs.test.ts#L175))

- **FR-19i.3** The metered totals carry the window's prompt-cache reads and writes
  (FR5.1d of the dark-factory spec) beside the uncached input, since a
  Claude run reads most of its input from the cache. ([validated by totals 10 calls' 9000 cache-read and 400 cache-write tokens @49cac651](apps/lore-api/src/integration-tests/spend-unit-costs.test.ts#L196), [carries 9000000 cache-read and 250000 cache-write tokens beside the metered totals @1c86b40b](apps/lore-api/src/transport/routes/analytics/spend-window.test.ts#L252))

- **FR-19i.4** `/spend` renders the unit costs in their own "Cost per unit
  of work" band, pilled as an estimate since they are summed from the same
  metered calls: the ticket and PR summaries (count, total, average,
  median), the five dearest and five cheapest of each linked to its Issue or
  pull request — a ticket known only by its description is named without a
  link — the review cost per line and per model, and the per-node table with
  visits, total, cost per visit and models. Each table says so when the
  window holds nothing for it. The headline cards carry the cache-read and
  cache-write token totals beside the input and output tokens. ([validated by shows 71 tickets at 872 USD total, 12.28 average and 5.99 median @e3e75229](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L92), [links the dearest ticket lore 1648 to its issue @e371b9ea](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L100), [names a ticket known only by its description without a link @0259ec14](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L113), [shows the review line averages: 1.18 per review, 0.19 per recheck @15df3685](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L124), [links the dearest PR bowman-ui 127 to its pull request @f143878e](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L133), [lists review cost by model, gemini-3.1-pro-preview at 39.20 @45f878e7](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L146), [shows tdd-round at 10 visits, 1.40 per visit, on its two models @12cc9e4b](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L154), [says so when the window holds no tickets, reviews or node visits @45a92a62](apps/web-ui/src/app/spend/SpendUnitCosts.test.tsx#L162), [gives the cost per ticket, PR review and node its own estimate section @bada9756](apps/web-ui/src/app/spend/SpendView.test.tsx#L520), [headlines 4200000 cache-read and 180000 cache-write tokens beside the input tokens @9e330f27](apps/web-ui/src/app/spend/SpendView.test.tsx#L213))

### FR-20: Project Facade Ports (Phase 1)

The `Project` facade (ADR-024) exposes every data capability — tasks,
events, chunks, features, agents, workspace, PRs, issues, cost/usage
accounting — through repo-bound ports with a Postgres/GCS/HTTP adapter
and an in-memory double per port, so Floor, mcp-server, and lore-api
share one persistence surface instead of inline SQL. ([validated by `awaitingApproval selects approval-gated tasks carrying an issue` @395a2432](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L21))

- FR-20.1: The `TaskQueue` port drives org-wide sweep: it exposes
  `awaitingApproval`, `distinctTargetRepos`, `prInfo`, and
  `findRecoverable`. ([validated by `task-queue.test.ts@5617af6b`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L7), [`task-queue.test.ts@395a2432`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L21), [`task-queue.test.ts@ab37b5c2`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L32), [`task-queue.test.ts@2941dd8e`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L45), [`task-queue.test.ts@ca43b800`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L59), [`task-queue.test.ts@6a4a16bc`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L72), [`task-queue.test.ts@d5eb2136`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L127), [`task-queue.test.ts@6c88711e`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L149), [`task-queue.test.ts@e54da5f5`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L159))
- FR-20.1b: `setColumns` writes only the given allow-listed task columns
  WITHOUT touching status or updated_at, issues no SQL for an empty column
  set, and throws on any key outside `SETTABLE_TASK_COLUMNS` — identically
  in the Pg adapter and the in-memory double, so a typo'd column fails
  loudly in tests instead of silently no-oping in production; the double
  additionally assigns the columns onto the seeded row and stays a no-op
  for an unknown task id. ([validated by `task-queue.test.ts@ccde1713`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L321), [`task-queue.test.ts@f1f2b3cb`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L340), [`task-queue.test.ts@05051f83`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L353), [`task-queue.test.ts@bd3d8fa2`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L360), [`task-queue.test.ts@5dd518b1`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L372), [`task-queue.test.ts@45b5a29b`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L384))
- FR-20.1c: `activeTaskByIssue` returns null for a task that no longer holds its issue: `failed`, `cancelled` or `retried`. A `retried` task handed its work to the retry, so it must not block the issue from being picked again (#2009). It answers with the newest such task and its status *(amended 2026-10-19)*, and a settled one (`completed` or `merged`) holds the issue only while the loop branch has an open pull request (`taskHoldingTicket`, `libs/shared/src/work/backlog/ticket-holder.ts`). A completed task whose pull request awaits review still holds it *(amended 2026-09-14, #2069)*: treating it as terminal made the backlog loop start the same ticket again on the same branch, and on 2026-09-14 re-cinq/Otto#19's second run pushed five rounds of commits onto PR #231 one minute after the first run had marked it ready for review. But a parked run settles its task `completed` too, with no pull request, and counting that as held meant removing `lore:blocked` re-queued nothing: 19 of re-cinq/Otto's tickets sat out the loop from 2026-10-13 to 2026-10-19. ([validated by InMemory returns null for a retried task — retried is terminal and must not guard the issue @4b415279](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L248), [validated by InMemory returns status completed for issue 85's settled task t1 @f4d0160a](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L256), [validated by PgTaskQueue SQL reads the newest task's id and status, leaving out failed, cancelled and retried ones @f97530fb](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L267), [validated by skips #5 while its completed task's pull request 77 is still open and picks #9 @cff635a2](libs/shared/src/work/backlog/implementation-loop-tick.test.ts#L257), [validated by picks #302 when its only task is completed and its branch has no open pull request @ea516d1f](libs/shared/src/work/backlog/implementation-loop-tick.test.ts#L275))
- FR-20.1a: The `pipeline.tasks` queue, exercised end-to-end against Postgres,
  backs those port behaviors: a created task defaults to `pending` status and
  `normal` priority (accepting an explicit `immediate`); a claim is atomic (a
  second claim of the same row takes nothing); the claim query applies a 30s
  grace window that excludes just-created tasks yet lets an `immediate` task
  through without the grace; a task walks `pending → running → completed`,
  recording a transition event per step for the audit trail and a
  `failure_reason` on failure; the review loop increments `review_iteration`;
  and run-now flips a pending task's priority from `normal` to `immediate`.
  ([validated by `creates a task in pending status` @da4c6fb5](apps/lore-api/src/integration-tests/pipeline.test.ts#L28), [validated by `claims a task atomically` @314c128e](apps/lore-api/src/integration-tests/pipeline.test.ts#L38), [validated by `30s grace period excludes recently created tasks` @a43f818e](apps/lore-api/src/integration-tests/pipeline.test.ts#L68), [validated by transitions through full lifecycle: pending -> running -> completed @36e4697e](apps/lore-api/src/integration-tests/pipeline.test.ts#L86), [validated by `records task events for audit trail` @3609260e](apps/lore-api/src/integration-tests/pipeline.test.ts#L118), [validated by `handles failure with reason` @31d08836](apps/lore-api/src/integration-tests/pipeline.test.ts#L149), [validated by `tracks review iterations` @b2e13475](apps/lore-api/src/integration-tests/pipeline.test.ts#L171), [validated by creates tasks with default priority 'normal' @f14046ce](apps/lore-api/src/integration-tests/pipeline.test.ts#L192), [validated by creates tasks with explicit priority 'immediate' @b7621645](apps/lore-api/src/integration-tests/pipeline.test.ts#L202), [validated by GKE worker query picks up immediate tasks without grace period @00117df6](apps/lore-api/src/integration-tests/pipeline.test.ts#L212), [validated by run-now: updates priority from normal to immediate @b58a2f9d](apps/lore-api/src/integration-tests/pipeline.test.ts#L234))
- FR-20.2: Nothing dispatches a spec-task any more: the executor that did, and the
  admission rules that capped a plan's group at three concurrent tasks, are
  removed *(rewritten 2026-10-07, `specs/external-floor` FR15.0)*. The
  methods answer for the rows that already exist and for
  nothing new. A plan's tasks reach the implementation loop as tickets
  (`specs/7-feature-planning` FR-11.13).
  ([`task-queue.test.ts@d5eb2136`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L127), [`task-queue.test.ts@6c88711e`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L149), [`task-queue.test.ts@e54da5f5`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L159), [`task-queue.test.ts@aa8445ab`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L174), [`task-queue.test.ts@54089816`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L196), [`task-queue.test.ts@e40d6b0f`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L208), [`task-queue.test.ts@8190841e`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L217), [`task-queue.test.ts@c252b4c3`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L223), [`task-queue.test.ts@e3734acf`](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L237), [validated by creates nothing when lore/x exists @697c8d2d](libs/shared/src/outbound/project/repo/ensure-branch.test.ts#L34))
- FR-20.3: The repo-scoped `TaskStore` port queries pending statuses,
  transitions a cancel to `cancelled`, writes `setStatus` (status +
  updated_at + only allowlisted extra columns), reads-old-then-writes-new
  status recording the transition event on `updateStatus`, and filters
  `findOpenLike` by repo, type, description prefix, and given statuses —
  each bound to the facade's repo. ([validated by `task-store-pg.test.ts@ab7ef2ee`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L23), [`task-store-pg.test.ts@316dcc09`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L38), [`task-store-pg.test.ts@950d60f0`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L51), [`task-store-pg.test.ts@3d192b47`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L68), [`task-store-pg.test.ts@7ca53d29`](libs/shared/src/outbound/project/tasks/task-store-pg.test.ts#L82))
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
  `getWithEvents` mirror the SQL. ([validated by `task-store-memory.test.ts@11ecf43c`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L38), [`task-store-memory.test.ts@151604c5`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L48), [`task-store-memory.test.ts@a104f76c`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L70), [`task-store-memory.test.ts@000d3a12`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L91), [`task-store-memory.test.ts@37a820ef`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L109), [`task-store-memory.test.ts@ca53964e`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L134), [`task-store-memory.test.ts@90c7319c`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L146), [`task-store-memory.test.ts@56ba6f01`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L158), [`task-store-memory.test.ts@5bfda114`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L166), [`task-store-memory.test.ts@4e34b08f`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L180), [`task-store-memory.test.ts@d451158e`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L203), [`task-store-memory.test.ts@74ec2998`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L213), [`task-store-memory.test.ts@06b9f934`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L261), [`task-store-memory.test.ts@82b34ffa`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L400), [`task-store-memory.test.ts@f1915d6b`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L414), [`task-store-memory.test.ts@56c1ce52`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L430))
- FR-20.3a: The in-memory store also answers two reap-support reads:
  `findStuckRunning` finds only tasks of the given type, status `running`,
  past the age threshold, and `countRecentFailures` counts an issue's own
  LIKE-matching failures created since a cutoff. ([validated by `task-store-memory.test.ts@f5786476`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L293), [`task-store-memory.test.ts@2f795540`](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L342))
- FR-20.4: The task-list surface returns the repo's pending tasks as
  typed `Task` wrappers and reflects the new status after `cancel()`.
  ([validated by `task-list.test.ts@577976a4`](libs/shared/src/outbound/project/tasks/task-list.test.ts#L98), [`task-list.test.ts@1725708a`](libs/shared/src/outbound/project/tasks/task-list.test.ts#L115))
- FR-20.5: The `EventReporter` port is the produce side of `pipeline.events`
  and nothing more: `insert` writes through the shared idempotent statement
  and collapses a redelivery sharing a dedupe key. Claiming, acking,
  failing with backoff, reaping and pruning happen on the subscriber's own
  `pipeline.event_deliveries` row (ADR-044), never on the event. ([validated by `event-reporter.test.ts@8ba468cb`](libs/shared/src/outbound/project/events/event-reporter.test.ts#L9), [`event-reporter.test.ts@2f3da297`](libs/shared/src/outbound/project/events/event-reporter.test.ts#L26), [`event-reporter.test.ts@de43436d`](libs/shared/src/outbound/project/events/event-reporter.test.ts#L55), [`event-deliveries.contract.test.ts@c6fc1cf9`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L116), [`event-deliveries.contract.test.ts@e6250ab3`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L152), [`event-deliveries.contract.test.ts@9d208f96`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L203), [`event-deliveries.contract.test.ts@4dc598fd`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L295))
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
  ([validated by returns true when information_schema lists the schema @b7c79380](libs/shared/src/outbound/project/chunks/chunks.test.ts#L49), [`chunks.test.ts@41fca258`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L242), [`chunks.test.ts@967d919f`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L57), [`chunks.test.ts@ed2e2e07`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L63), [`chunks.test.ts@6617d8b4`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L73), [`chunks.test.ts@e3ad7a9f`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L88), [`chunks.test.ts@0d28a680`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L105), [`chunks.test.ts@734876b7`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L113), [`chunks.test.ts@139036fb`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L124), [`chunks.test.ts@815f8771`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L138), [`chunks.test.ts@3d0ac8d1`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L146), [`chunks.test.ts@235002f9`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L152), [`chunks.test.ts@8be458b5`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L160), [`chunks.test.ts@8caa545d`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L178), [`chunks.test.ts@7c140354`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L197), [`chunks.test.ts@7769f8b9`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L219), [`chunks.test.ts@c276ebfd`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L275), [`chunks.test.ts@6679f495`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L289), [`chunks.test.ts@1a3943f8`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L297), [`chunks.test.ts@f7dae73b`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L341), [`chunks.test.ts@54c965f0`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L373), [`chunks.test.ts@ec5c81ae`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L405), [`chunks.test.ts@b6625866`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L416), [`chunks.test.ts@b6db10b3`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L431), [`chunks.test.ts@a9fa38a8`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L440), [`chunks.test.ts@d4594ce6`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L447), [`chunks.test.ts@8724544a`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L469), [`chunks.test.ts@f1025786`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L492), [`chunks.test.ts@84d616b3`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L500), [`chunks.test.ts@7756629e`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L529), [`chunks.test.ts@eb1975ce`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L543), [`chunks.test.ts@5c4d7b70`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L706), [`chunks.test.ts@2a8ab318`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L739))
- FR-20.7: The HTTP `Chunks` adapter reads spec chunks (and backfill
  chunks with embeddings) from the repo-scoped API with a bearer token,
  maps `hasChunk` to its query endpoint, and throws
  on a non-ok response and on the Floor-only write surface. ([validated by `chunks-http.test.ts@fecd597c`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L28), [`chunks-http.test.ts@56b76321`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L43), [`chunks-http.test.ts@67ca5df9`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L57), [`chunks-http.test.ts@4a405935`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L91))
- FR-20.12: The `AgentDefs` port resolves an agent definition through
  three layers (yaml base → org row → project row), inheriting nullable
  fields upward and letting each higher layer override, returning null
  when every layer is null; with no floor and no API every read is
  refused (the offline files adapter was removed 2026-11-01); the facade
  lists and delegates create/delete with the bound repo; and the HTTP
  adapter resolves/lists via the bearer-authed API (null on 404).
  ([validated by returns the org row as stored when no project row exists @aaa295cf](libs/shared/src/outbound/project/agents/agent-defs-port.test.ts#L17), [returns null when every layer is null @9457776f](libs/shared/src/outbound/project/agents/agent-defs-port.test.ts#L21), [validated by refuses to list re-cinq/lore's agents, naming the floor as the only store @5dc458a2](libs/shared/src/outbound/project/agents/agent-defs-no-floor.test.ts#L11), [inherits a nullable field from org when the project row leaves it null @cc6fd7bb](libs/shared/src/outbound/project/agents/agent-defs-port.test.ts#L50), [`agent-defs.test.ts@b91337a3`](libs/shared/src/outbound/project/agents/agent-defs.test.ts#L55), [`agent-defs.test.ts@eeb6160e`](libs/shared/src/outbound/project/agents/agent-defs.test.ts#L63), [`agent-defs-http.test.ts@85103c26`](libs/shared/src/outbound/project/agents/agent-defs-http.test.ts#L56), [`agent-defs-http.test.ts@263bac65`](libs/shared/src/outbound/project/agents/agent-defs-http.test.ts#L65), [`agent-defs-http.test.ts@70092d9d`](libs/shared/src/outbound/project/agents/agent-defs-http.test.ts#L71))
- FR-20.13: The `Workspace`/`Git` ports carry the installation token as a
  base64 `x-access-token` `http.extraheader` override (honouring a
  non-default host, never embedding the raw token in the args or
  `.git/config`) and build a credential-free https URL when tokenless;
  the git CLI clones and reads a seeded file, writes/commits on a new
  branch and pushes (falling back to the Lore Agent identity), and
  `ensureClone`/`ensureCheckout` cache-reuse via fetch, pin the branch,
  and refuse to switch a dirty tree; the workspace facade writes-then-
  reads a file committing through the GitPort and pushes then opens the
  PR via the pulls port. ([validated by `git-auth.test.ts@fc5d001f`](libs/shared/src/outbound/project/workspace/git-auth.test.ts#L5), [`git-auth.test.ts@c6e0855d`](libs/shared/src/outbound/project/workspace/git-auth.test.ts#L14), [`git-auth.test.ts@cd85f11a`](libs/shared/src/outbound/project/workspace/git-auth.test.ts#L20), [`git-auth.test.ts@88f29db4`](libs/shared/src/outbound/project/workspace/git-auth.test.ts#L26), [`git-cli-auth.test.ts@85214ca4`](libs/shared/src/outbound/project/workspace/git-cli-auth.test.ts#L20), [`git-cli-auth.test.ts@ba915ec9`](libs/shared/src/outbound/project/workspace/git-cli-auth.test.ts#L33), [`git-cli-auth.test.ts@9241500e`](libs/shared/src/outbound/project/workspace/git-cli-auth.test.ts#L44), [`git-cli.test.ts@14c1e9cd`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L47), [`git-cli.test.ts@b2ece84c`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L57), [`git-cli.test.ts@fd117022`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L75), [`git-cli.test.ts@a8955ff4`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L94), [`git-cli.test.ts@b1c63d18`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L105), [`git-cli.test.ts@94922ac2`](libs/shared/src/outbound/project/workspace/git-cli.test.ts#L123), [`workspace.test.ts@d4887154`](libs/shared/src/outbound/project/workspace/workspace.test.ts#L33), [`workspace.test.ts@d18f5f77`](libs/shared/src/outbound/project/workspace/workspace.test.ts#L46))
- FR-20.14: The `Repo` files port reads a file at a given ref (null when
  absent) and creates a branch committing a file via the API, repo bound.
  ([validated by `repo-files.test.ts@e08d7a2c`](libs/shared/src/outbound/project/repo/repo-files.test.ts#L60), [`repo-files.test.ts@19fcda3d`](libs/shared/src/outbound/project/repo/repo-files.test.ts#L72), [`repo-files.test.ts@56bebb65`](libs/shared/src/outbound/project/repo/repo-files.test.ts#L78))
- FR-20.15: The `PullRequests` port lists only the repo's PRs, merges by
  number with the requested method, and exposes PR reads bound to the
  repo and number. ([validated by `pull-requests.test.ts@dd2a274a`](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L121), [`pull-requests.test.ts@b5fdf3b5`](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L157), [`pull-requests.test.ts@4a83fe6a`](libs/shared/src/outbound/project/pulls/pull-requests.test.ts#L166))
- FR-20.16: The `Issues` port returns the GitHubPort issues for the
  project's repo, creates an issue bound to the repo, and comments,
  closes, and labels by number bound to the repo. ([validated by `issues.test.ts@b52879bd`](libs/shared/src/outbound/project/issues/issues.test.ts#L68), [`issues.test.ts@c1c72db5`](libs/shared/src/outbound/project/issues/issues.test.ts#L112), [`issues.test.ts@ab836276`](libs/shared/src/outbound/project/issues/issues.test.ts#L125))
- FR-20.17: The `TestRunner` port lists tests in a trusted sandbox (no
  `LORE_DB_HOST`); its exec adapter lists the descriptors from the
  manifest `list` command, runs a single test aggregating the report, and
  runs `run` once per file (selector = file) fanning the result to each
  descriptor. ([validated by `test-suite.test.ts@36bcb53e`](libs/shared/src/outbound/project/test-runner/test-suite.test.ts#L37), [`test-runner-exec.test.ts@c7bd5a3b`](libs/shared/src/outbound/project/test-runner/test-runner-exec.test.ts#L36), [`test-runner-exec.test.ts@76ae2613`](libs/shared/src/outbound/project/test-runner/test-runner-exec.test.ts#L44), [`test-runner-exec.test.ts@a13277d4`](libs/shared/src/outbound/project/test-runner/test-runner-exec.test.ts#L58))
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
  out-of-window rows). ([validated by `usage-pg.test.ts@86589292`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L31), [`usage-pg.test.ts@2edf0c9c`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L79), [`usage-pg.test.ts@38ade797`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L143), [`usage-pg.test.ts@ba5bea52`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L158), [`usage-pg.test.ts@083079af`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L173), [`usage-pg.test.ts@b001b39b`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L189), [`usage-pg.test.ts@dfabb856`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L221), [`usage-pg.test.ts@de54386e`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L238), [`usage-pg.test.ts@8386da9c`](libs/shared/src/outbound/project/usage/usage-pg.test.ts#L254), [`cost.test.ts@b2b48ad6`](libs/shared/src/outbound/project/cost/cost.test.ts#L36), [`cost.test.ts@ecc2d9c4`](libs/shared/src/outbound/project/cost/cost.test.ts#L60), [`cost.test.ts@4065e5e5`](libs/shared/src/outbound/project/cost/cost.test.ts#L68), [`cost.test.ts@e44d831b`](libs/shared/src/outbound/project/cost/cost.test.ts#L80), [`job-runs.test.ts@0d689710`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L23), [`job-runs.test.ts@e631c8ff`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L36), [`job-runs.test.ts@cc3f4d7a`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L54), [`job-runs.test.ts@c9a482ca`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L62), [`job-runs.test.ts@dead52f2`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L72), [`job-runs.test.ts@cd76bc47`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L86), [`job-runs.test.ts@286ebeee`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L94), [`job-runs.test.ts@029c5ccd`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L104), [`job-runs.test.ts@605f07c8`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L118), [`job-runs.test.ts@94e52592`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L131), [`job-runs.test.ts@3b75aa6f`](libs/shared/src/outbound/project/job-runs/job-runs.test.ts#L172))
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
  ([validated by `usage-memory.test.ts@14c241db`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L12), [`usage-memory.test.ts@1ac403e7`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L25), [`usage-memory.test.ts@08c35372`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L38), [`usage-memory.test.ts@28c7bcec`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L87), [`usage-memory.test.ts@05f376fc`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L103), [`usage-memory.test.ts@b6a3c623`](libs/shared/src/outbound/project/usage/usage-memory.test.ts#L133))
- FR-20.19: The `Archive` GCS port saves to `<bucket>/<key>`
  non-resumable with the given content type (passing `cacheControl`
  through as file metadata) and returns the object content as utf-8, null
  when the object is absent or the storage call throws. ([validated by `archive-gcs.test.ts@f45420fc`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L37), [`archive-gcs.test.ts@abebbdef`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L54), [`archive-gcs.test.ts@ca221785`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L72), [`archive-gcs.test.ts@8e4a519c`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L82), [`archive-gcs.test.ts@a4550d6b`](libs/shared/src/outbound/project/archive/archive-gcs.test.ts#L91))
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
  once. ([validated by `chunk-schema.test.ts@011309dd`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L27), [`chunk-schema.test.ts@37815e7f`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L35), [`chunk-schema.test.ts@7c950953`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L41), [`chunk-schema.test.ts@0db22e03`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L48), [`chunk-schema.test.ts@fc160c01`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L57), [`chunk-schema.test.ts@678368c8`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L66), [`chunk-schema.test.ts@8e797f03`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L78), [`chunk-schema.test.ts@d011fa34`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L87), [`chunk-schema.test.ts@3a9126b7`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L95), [`chunk-schema.test.ts@41d29fb4`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L110), [`chunk-schema.test.ts@329ff6c7`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L123), [`chunk-schema.test.ts@056f2143`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L150), [`chunk-schema.test.ts@c18bc0f7`](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L163))
- FR-20.21: Legacy chunk relocation runs when a repo's team changes
  (`internal.repo.team_changed`, handled on the Floor): it MOVEs any rows
  the repo still holds in `org_shared.chunks` into its resolved schema — per-file
  dedupe keeps a file already fresh in the target and drops its stale
  org_shared duplicates, files absent from the target relocate wholesale
  preserving id, embedding, and `ingested_at`, rewriting `team`, stamping
  `metadata.migrated_from` ([validated by `chunks.test.ts@a5f32c65`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L604), [`chunks.test.ts@d9325315`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L621), [`chunks.test.ts:622`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L654))
  - Provenance-less rows with a classifyFile content type are adopted via
    `ingested_by = 'reindex-job'`; other content types relocate unowned ([validated by `chunks.test.ts@a5f32c65`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L604), [`chunks.test.ts@b559b2f5`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L644))
  - The Pg adapter issues copy and delete as one statement (shared
    snapshot, insert before delete, repo and team as bind parameters),
    a clean repo is a zero no-op, and `org_shared` is rejected as a
    relocation target in every adapter — self-relocation would dedupe
    rows against themselves and delete them ([validated by `chunks.test.ts@c13bc53d`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L667), [`chunks.test.ts@3a76936a`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L678), [`chunks.test.ts@f5e38808`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L690))
  - The station HTTP adapter refuses relocation as Floor-only ([validated by `chunks-http.test.ts@4a405935`](libs/shared/src/outbound/project/chunks/chunks-http.test.ts#L91))
  - `PUT /api/repos/:o/:r/settings` on lore-api emits one
    `internal.repo.team_changed` event only when the write actually changes
    the team value (settings-only patches and same-value writes emit
    nothing), and a failed event insert degrades to the nightly relocation
    instead of failing the settings write that already happened. It REFUSES
    a patch carrying a `dark_factory` block (400, writing nothing at all):
    those settings were removed on 2026-10-02 and nothing reads them. The
    web-ui route forwards to it,
    normalizing a cleared team to null, and passes the refusal through
    with its status; the settings page shows that reason under the form ([validated by shows lore-api's reason when it refused the save @89a95124](apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx#L20), [validated by surfaces the server's refusal message in state.error @25b97e10](apps/web-ui/src/app/repos/[owner]/[repo]/settings/page.test.tsx#L43), [validated by returns an unconfigured error when the API is not configured @44522c88](apps/web-ui/src/app/repos/[owner]/[repo]/settings/page.test.tsx#L63), [validated by forwards a team change to lore-api @ff83db95](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L32), [`route.test.ts@e7db3237`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L43), [`route.test.ts@1deb0e8f`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L51), [`route.test.ts@896ef2b7`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L61), [`route.test.ts@8605bf32`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L76), [`repo-settings.test.ts@254c21f5`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L49), [`repo-settings.test.ts@7ed06644`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L53), [`repo-settings.test.ts@e842be2a`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L61), [`repo-settings.test.ts@e842be2a`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L61), [`repo-settings.test.ts@309ce391`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L84), [`repo-settings.test.ts@289cb4e4`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L106), [`repo-settings.test.ts@f56794ae`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L129), [`repo-settings.test.ts@309ce391`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L84), [`repo-settings.test.ts@289cb4e4`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L106), [`repo-settings.test.ts@f56794ae`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L129), [`repo-settings.test.ts@114aaced`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L146), [`repo-settings.test.ts@2127891a`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L232), [`repos.test.ts@d8e944a2`](apps/web-ui/src/lib/api/repos.test.ts#L127))
  - The `team_changed` handler, in the stations service since 2026-10-02, re-reads the team from `lore.repos`
    rather than trusting the event payload, resolves it through the uncached
    single-sourced `chunkSchemaOrOrgShared` (never the per-repo memoized
    resolver, which would serve the pre-change schema for its TTL), no-ops
    when resolution falls back to `org_shared`, and lets a relocation error
    propagate so the event loop retries the idempotent move ([validated by moves re-cinq/lore's legacy org_shared rows into platform, the schema its team resolves to @eba11ff8](apps/stations/src/events/team-changed.test.ts#L26), [relocates nothing for a repository whose team resolves to org_shared @05f119f7](apps/stations/src/events/team-changed.test.ts#L37), [hands a cleared team to the resolver as null instead of deciding here @8d423a0c](apps/stations/src/events/team-changed.test.ts#L48), [says there was nothing to move when the repository had no legacy rows @1e079869](apps/stations/src/events/team-changed.test.ts#L56), [throws connection reset when the move fails, so the delivery is retried @bbfddb1f](apps/stations/src/events/team-changed.test.ts#L66))

## Non-Functional Requirements

### NFR-1: Security

- No long-lived credentials anywhere in the system. ([validated by `security-posture.test.ts@36bb5027`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L72), [`security-posture.test.ts@2f1964ef`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L87))
- Workload Identity for all GKE workloads. ([validated by `security-posture.test.ts@2ee19429`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L64))
- Workload Identity Federation for GitHub Actions. ([validated by `security-posture.test.ts@2f1964ef`](libs/shared/src/domain/infra-contract/security-posture.test.ts#L87))
- Schema-per-team isolation in the vector store. ([validated by `chunks.test.ts@2fc1ae53`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L167), [`chunks.test.ts@8caa545d`](libs/shared/src/outbound/project/chunks/chunks.test.ts#L178))
- Secret and PII redaction runs at ingest time and on every memory write:
  `sanitizeContent()` / `redactSecrets()` strip API keys, JWTs, private keys,
  connection strings, and bearer tokens before storage in the org-wide
  database. ([validated by `redact.test.ts@17019aa0`](libs/shared/src/lib/redact.test.ts#L5), [`redact.test.ts@b12695e0`](libs/shared/src/lib/redact.test.ts#L78))
- Centralized auth in `routes.ts`: every `/api/*` route enforces bearer
  token validation. Supports legacy single token (`LORE_INGEST_TOKEN`)
  and per-client scoped tokens with SHA-256 hashes. ([validated by `auth.test.ts@0a431a42`](apps/lore-api/src/transport/http/auth.test.ts#L91), [`bearer-scope.test.ts@31dccb5a`](apps/lore-api/src/transport/http/bearer-scope.test.ts#L41), [returns 401 {error:invalid token} when the token is not legacy and pool is null @c3e14276](apps/lore-api/src/transport/http/bearer-scope.test.ts#L48), [returns 401 when the DB has no matching token @e9c72e57](apps/lore-api/src/transport/http/bearer-scope.test.ts#L59), [grants any scope when the DB token has admin @501ec804](apps/lore-api/src/transport/http/bearer-scope.test.ts#L87), [returns 403 when the DB token lacks the scope the route needs @821fa09b](apps/lore-api/src/transport/http/bearer-scope.test.ts#L100), [returns 503 when the token lookup query throws @99216f9c](apps/lore-api/src/transport/http/bearer-scope.test.ts#L113), [grants access via the legacy token without hitting the DB @f03de842](apps/lore-api/src/transport/http/bearer-scope.test.ts#L126))
- Rate limiting: 30/min webhooks, 60/min task ops, 200/min other, 600/min
  for a person's web session token instead of that 200,
  (in-memory sliding window), counted per principal rather than per route
  class: a verified bearer spends its token hash's window, an anonymous or
  unverifiable caller spends its client address's window, with `X-Forwarded-For`
  read only for the hops `LORE_TRUSTED_PROXY_HOPS` declares, so one caller's
  flood never 429s another; GitHub deliveries and `/healthz` are never limited;
  idle windows are evicted, and `/api/ws` sockets
  are capped globally at 2000 and, only where `LORE_TRUSTED_PROXY_HOPS` makes the
  client address known, per address at 30 upgrades a minute and 20 open, with
  `open` messages limited to 30/min per socket. 1 MB body size limit. ([validated by `rate-limit.test.ts@8a5b2059`](apps/lore-api/src/transport/http/rate-limit.test.ts#L67), [validated by answers an open past 30 a minute on one socket with rate_limited @6adff33f](apps/lore-api/src/transport/http/rate-limit.test.ts#L368), [validated by routes a person's session token on /api/repos/re-cinq/otto/loops to the 600/min session bucket, and a service token to the 200/min default @23a54acb](apps/lore-api/src/transport/http/rate-limit.test.ts#L41), [`rate-limit.test.ts@0106f188`](apps/lore-api/src/transport/http/rate-limit.test.ts#L55), [`auth.test.ts@56b885a8`](apps/lore-api/src/transport/http/auth.test.ts#L22), [`webhook-incident.test.ts@7a5f503e`](apps/lore-api/src/transport/routes/webhooks/webhook-incident.test.ts#L144), [`rate-limit.test.ts@bb3461c6`](apps/lore-api/src/transport/http/rate-limit.test.ts#L159), [`rate-limit.test.ts@9fe15d8f`](apps/lore-api/src/transport/http/rate-limit.test.ts#L161), [`rate-limit.test.ts@6a5dec1e`](apps/lore-api/src/transport/http/rate-limit.test.ts#L172), [`rate-limit.test.ts@d491919c`](apps/lore-api/src/transport/http/rate-limit.test.ts#L188), [`rate-limit.test.ts@1cd097f6`](apps/lore-api/src/transport/http/rate-limit.test.ts#L205), [`rate-limit.test.ts@dfd4d963`](apps/lore-api/src/transport/http/rate-limit.test.ts#L242), [`rate-limit.test.ts@2ed6db20`](apps/lore-api/src/transport/http/rate-limit.test.ts#L281), [`rate-limit.test.ts@c88fce24`](apps/lore-api/src/transport/http/rate-limit.test.ts#L295), [`rate-limit.test.ts@de141dd7`](apps/lore-api/src/transport/http/rate-limit.test.ts#L306), [`rate-limit.test.ts@347213f6`](apps/lore-api/src/transport/http/rate-limit.test.ts#L355), [`rate-limit.test.ts@b465ca88`](apps/lore-api/src/transport/http/rate-limit.test.ts#L365), [`rate-limit.test.ts@94622011`](apps/lore-api/src/transport/http/rate-limit.test.ts#L358), [`auth.test.ts@909a6c2c`](apps/lore-api/src/transport/http/auth.test.ts#L38), [`auth.test.ts@98dbafa2`](apps/lore-api/src/transport/http/auth.test.ts#L50), [never answers a GitHub delivery 429, even past 250 from one address @de141dd7](apps/lore-api/src/transport/http/rate-limit.test.ts#L306), [ignores X-Forwarded-For unless proxy hops are declared @19425973](apps/lore-api/src/transport/http/rate-limit.test.ts#L258), [admits every upgrade when no trusted client address is known, since the ingress would make the whole org one address @f180fef1](apps/lore-api/src/transport/http/rate-limit.test.ts#L344), [refuses an upgrade the limiter denies, with 429 @8d62990c](apps/lore-api/src/work/assembly-line-station/live-socket.test.ts#L347), [refuses an upgrade while the global socket ceiling is reached, with 503 @262bdb96](apps/lore-api/src/work/assembly-line-station/live-socket.test.ts#L358), [caps the sockets one address holds open and admits another once one closes @cc5068da](apps/lore-api/src/work/assembly-line-station/live-socket.test.ts#L366), [applies neither the per-address cap nor the upgrade rate when no trusted client address is known @7e854523](apps/lore-api/src/work/assembly-line-station/live-socket.test.ts#L379), [answers an open the limiter denies with a rate_limited error and opens no channel @d6a07453](apps/lore-api/src/work/assembly-line-station/live-socket.test.ts#L393))
- Decision: Slack indexing is opt-in per channel only and DMs are never indexed; Lore indexes no Slack content today, so there is nothing to test yet.
- lore-api logs every unexpected handler or auth throw on the hapi `request` error
  channel under an `[http]` tag with method, path, request id and stack, so no route
  500s anonymously. ([validated by `names an unexpected route throw on the console instead of 500ing anonymously` @1dba04db](apps/lore-api/src/app/build-server.test.ts#L5))

### NFR-2: Reliability & Freshness

- `lore_assemble_context` warns when repo context is stale (>7 days since
  last ingest) or missing (first-run welcome with suggested actions). ([validated by `context-freshness.test.ts@f3880e47`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L35), [`context-freshness.test.ts@4669293a`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L41), [`context-freshness.test.ts@058082d2`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L47), [`context-freshness.test.ts@37ca6091`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L51), [`context-freshness.test.ts@039f20a3`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L57))
- *(amended 2026-11-02)* There is no offline context search: the
  install has no offline mode (ADR-032), and `lore_search_context` with no
  Lore API configured says so instead of scanning local files. The
  last-synced CLAUDE.md files and ADRs in `~/.re-cinq/lore` stay readable
  as files. ([validated by says the corpus search needs LORE_API_URL instead of scanning local files @1d1519e3](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L28))
- Dgraph's one pod MUST NOT be deleted by node scale-down: a PodDisruptionBudget of `minAvailable: 1` protects it, because a restart can leave its disk attached to the old node and every graph read and ingest failing for about 40 minutes. ([validated by declares a PodDisruptionBudget of minAvailable 1 that selects the Dgraph pod @a8443587](libs/shared/src/domain/infra-contract/security-posture.test.ts#L101))

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
- Web UI (`/onboard`, pipeline status, run transcripts, analytics, knowledge graph, gaps). ([validated by `GapsView.test.tsx@b521994f`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L33), [`GraphView.test.tsx@6a17ec38`](apps/web-ui/src/app/graph/GraphView.test.tsx#L35), [`AnalyticsView.test.tsx@1d0f4487`](apps/web-ui/src/app/analytics/AnalyticsView.test.tsx#L116), [`NodeLogPanel.test.tsx@f00305c8`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L86), [`OnboardView.test.tsx@b2e07622`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L11))
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
