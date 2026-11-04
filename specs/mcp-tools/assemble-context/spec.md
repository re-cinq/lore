# Feature Specification: lore_assemble_context MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_assemble_context MCP Tool      |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_assemble_context`             |
| Module  | Context (`context/assemble-context.ts`)   |
| Scope   | shared                         |

`lore_assemble_context` is the mandatory first call for a task: it pulls from every knowledge source at once — conventions, ADRs, memories, facts, episodes, and graph relationships — and returns one token-budgeted, template-ordered, provenance-tagged block an agent consumes directly.

## Problem Statement

A Claude Code session starting a task needs conventions, ADRs, memories, facts,
episodes, and graph relationships before it can plan or build. Fetching these
one source at a time wastes the agent's first turns and leaves the caller to
stitch the pieces into a coherent, token-budgeted block. `lore_assemble_context` is
the single call that retrieves from every source, orders sections by a
task-type template, fits a token budget, and emits a provenance-tagged block an
LLM consumes directly. A call naming `backend: "lore-v2"` gets a block built from
the task's own questions instead; see [Context builder](#context-builder-2026-11-03-4090).

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/transport/tools/context/assemble-context.ts)).

- **name**: `lore_assemble_context`
- **description** (verbatim):

```text
Assembles ONE token-budgeted, template-ordered context block by pulling from every source at once (repo conventions/docs, ADRs, memories, facts, episodes, graph relationships) and returning a single provenance-tagged text block. With backend lore-v2 the block is instead built from the task's own questions: a repo primer, key facts each citing its source, where to look, and previous work. This is the mandatory first call when starting any task — use it before the narrower retrieval tools.
Instead: use lore_search_context for raw passages/exact wording from ingested docs; use lore_search_memory for past learnings, decisions, and extracted facts from prior sessions; use lore_query_graph for entity relationships. Those three are the building blocks this tool already combines.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `query` | string | yes | — | Natural-language description of the context needed. Drives retrieval and ranking across all sources. |
| `template` | string | no | `default` | Section-ordering profile. Recognized values: 'default' \| 'review' \| 'implementation' \| 'research'. Unrecognized values silently fall back to 'default'. Note: template choice does NOT raise the token budget — max_tokens always defaults to 8000 regardless of template, so pass max_tokens explicitly for research queries. Ignored under `lore-v2`. |
| `max_tokens` | number | no | `8000` | Token budget for the assembled block; floor 2000. Raise to ~16000 for research-heavy queries. Defaults to 8000. |
| `repo` | string | no | — | 'owner/repo'. Auto-detected from the git remote when omitted; in the agent gateway the description says it is required. |
| `agent_id` | string | no | — | Overrides the ambient agent id used to scope memories/facts. |
| `cross_repo` | boolean | no | `false` | When true, also pulls context from linked repos in the org. Falls back to the repo's settings.cross_repo when false. |
| `backend` | `"lore" \| "utopia" \| "both" \| "lore-v2"` | no | — | utopia (default), lore, or both: the template assembly over that store. lore-v2: a block built from the task's own questions over Lore's stores. |

The whole handler body is wrapped in `trackLatency('lore_assemble_context', …)` which
records latency + success into `memory.audit_log` and an OTEL span.

## Behavior

1. Acquire the pg pool via `getPool()`.
2. **Availability gate** — if `isMemoryDbAvailable()` is false:
   1. Read `LORE_API_URL` + `LORE_INGEST_TOKEN`.
   2. If **both** present, resolve `repo || detectCurrentRepo() || ""` and
      `GET {LORE_API_URL}/api/context?query=&template=&repo=` with
      `Authorization: Bearer {token}`. On a 2xx JSON response with a `text`
      field, return that text **prefixed** with the line
      `<!-- context: proxied from GKE, template={template} -->\n\n`. Any
      fetch/parse error falls through.
   3. If the proxy is not configured or fails, return the literal text
      `"Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured."`
3. **Cross-repo resolution** — start with the `cross_repo` argument; if false and
   a `repo` + pool are present, `SELECT settings FROM lore.repos WHERE full_name = $1`
   and enable cross-repo when `settings.cross_repo === true`. A query error is
   non-fatal (stays disabled).
4. Delegate to the engine
   `assembleContext(pool, query, template, max_tokens, repo, agent_id, enableCrossRepo)`
   ([engine](../../../libs/shared/src/outbound/project/knowledge/context-assembly.ts), re-exported
   [here](../../../libs/server-core/src/work/context/context-assembly.ts#L10)). The engine
   returns `{ text, sections: { tokens, … }[] }` — its retrieval/ranking/XML-emission
   contract is owned by [`context-assembly`](../../context-assembly/spec.md).
5. **Empty guard** — if `result.text` is empty/whitespace, return
   `"No relevant context found for this query."`
6. **Success envelope** — return `result.text` prefixed with
   `<!-- context: template={template}, sections={N}, tokens={sum of section tokens} -->\n\n`.

## Output

A single MCP text content block. One of, in priority order: the success envelope
(meta comment + assembled text), the GKE-proxied envelope, the "no relevant
context" text, the "requires PostgreSQL or LORE_API_URL" text. **Never throws** — every path returns text.

## Dependencies & side effects

- `isMemoryDbAvailable()`, `getPool()` (pool may be null), `detectCurrentRepo()`.
- `assembleContext` engine (PostgreSQL reads, optional Vertex embeddings).
- Read of `lore.repos.settings` for the cross-repo flag.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN` (proxy path only).
- Writes a latency row to `memory.audit_log` via `trackLatency`.

## Acceptance Criteria

The engine returns empty text and an empty section list when no source returns
rows. ([validated by `returns empty text when no sources return data`](libs/server-core/src/work/context/context-assembly.test.ts#L76))

A repo source returning a `doc` chunk yields a Conventions section containing
that chunk's content. ([validated by `assembles context from repo source`](libs/server-core/src/work/context/context-assembly.test.ts#L94))

Content exceeding the budget is truncated so the assembled text stays within the
token budget and the section is marked truncated. ([validated by `respects token budget`](libs/server-core/src/work/context/context-assembly.test.ts#L130))

Retrieved documents are emitted as XML tags carrying source/type/relevance
provenance with the chunk markdown contained inside the tag. ([validated by `emits XML-tagged documents carrying provenance, with markdown contained`](libs/server-core/src/work/context/context-assembly.test.ts#L159))

The debug trace reports per-section inclusion status and an omit reason for empty
sources. ([validated by `debug trace reports per-section status and omit reason for empty sources`](libs/server-core/src/work/context/context-assembly.test.ts#L290))

On the proxy path, a reachable backend response is authoritative over any cached
copy: an empty-but-reachable context is returned as-is (never a stale cache), and
a reachable non-empty response returns the live text. ([validated by returns an empty-but-reachable context as-is instead of a stale cached copy](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L179), [validated by returns the live result on a reachable hit](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L211))

*(added 2026-10-01, #2103)* The shared agent gateway has no checkout, so it never
shells out to git for a repo or branch: a call that names no repo is answered with
"pass repo as owner/name" instead of proxying an empty one, the `repo` description
says it is required there, and an API refusal reads as "Lore API rejected
lore_assemble_context" with the API's reason, never as an unreachable API. A laptop's
stdio adapter still reads its checkout's git remote.
([validated by asks for the repo instead of proxying an empty one when the call names none](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L225), [validated by logs sources none and tokens 0 for an answer with no sections](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L95), [validated by says assembly needs the API when LORE_API_URL is unset](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L258), [validated by hands the read the repo re-cinq/lore the call names](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L144), [validated by answers that the gateway needs the repo named when an agent call omits it](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L154), [`reports the API's refusal as a rejection with its reason, not as an unreachable API`](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L237), [`reads the checkout on a laptop when the call names nothing`](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L26), [`never shells out to git in the agent gateway, which has no checkout, and leaves an omitted repo to the caller`](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L33), [`takes the repo and branch the call names in either mode`](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L43), [`tells the gateway's caller the repo is required, and a laptop's that it is auto-detected`](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L52), [`refuses a repo that is not owner/name, with `..`, `?` or extra slashes`](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L85), [`accepts owner/name with dots, dashes and underscores`](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L99), [`answers with the refusal and never calls the read for a hostile repo`](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L107), [`answers that no repo could be detected on a laptop outside a checkout, instead of sending an empty repo`](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L128); implemented by [`repo-scope.ts`](apps/mcp-server/src/transport/tools/shared/repo-scope.ts))

*(added 2026-10-11, #2156)* On the shared agent gateway `repo` is a required parameter of every tool that reads a repo, enforced by the tool's Zod schema with the "pass repo as owner/name" hint; one gateway serves every pod, so no process-wide setting can name a call's repo and an omitted one is never filled from the environment, the working directory or a git remote. ([validated by rejects an omitted repo in the gateway with the owner/name hint, and accepts one on a laptop](apps/mcp-server/src/transport/tools/shared/repo-scope.test.ts#L63))

*(added 2026-10-01, #2344)* An explicit `repo` must be an owner/name (letters, digits, dots, dashes, underscores, no `..`, one slash) or the tool answers "Invalid repo" before any API call, so a caller-supplied value can never reshape the API path it is interpolated into; this holds for every tool that takes `repo`. On a laptop outside a checkout the call is answered with "Could not detect repo" instead of proxying an empty repo.

*(added 2026-10-11, #2344)* A pod has no checkout to name its repo from, so the brief that starts or resumes a planning run leads with `repo: "owner/name"` on its own line, the repo its prompt tells it to pass on every Lore call. ([validated by `leads the brief with repo: "re-cinq/lore", the repo the agent passes to Lore's tools`](apps/lore-api/src/work/plans/floor-plan-line.test.ts#L662))

The local task runner pre-fetched none of this: `withLoreWorkflowPreamble` opens
every locally-run task with `lore_assemble_context` as step 1 and ends with the
task itself, and there is no second, pre-loaded shape of the preamble to diverge
from it (the pre-run fetch was removed 2026-08-28).
([validated by `opens every local run with lore_assemble_context as step 1`](apps/mcp-server/src/work/pipeline/runner.local.test.ts#L710), [`ends with the task, so the instructions read as preamble to it`](apps/mcp-server/src/work/pipeline/runner.local.test.ts#L716), [`has one shape — nothing is pre-fetched, so there is no pre-loaded branch`](apps/mcp-server/src/work/pipeline/runner.local.test.ts#L720); implemented by [`runner-local-spawn.ts:28`](apps/mcp-server/src/work/pipeline/runner-local-spawn.ts#L28))

The `/api/context` endpoint runs full assembly when a `query` param is present and
a raw chunk fetch when it is absent.

The `max_tokens` input schema enforces the documented floor of 2000 — a lower
value is rejected and the floor itself is accepted.
([validated by rejects max_tokens below the 2000 floor](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L47), [validated by accepts max_tokens at the 2000 floor](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L53))

*(added 2026-10-16)* An optional `backend` param — "utopia (default), lore, or both — compare Lore's stores with Utopia; Utopia sources fill in as their readers land" — accepts only those three values and is forwarded to `GET /api/context` as `backend`; left unset it is not sent, so the API applies the repo's `settings.context_backend`. ([validated by accepts backend both and refuses backend dgraph](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L59), [validated by forwards backend=utopia to GET /api/context](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L129), [validated by forwards max_tokens 16000, cross_repo true and agent_id agent-7 to GET /api/context](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L143))

The handler's GKE-proxy success/empty/error envelope framing on the DB-backed path
is exercised only against live Postgres. *(untested: the success branch needs a
populated DB; the engine itself is covered above.)*

## Proxy timeout *(2026-10-31)*

`lore_assemble_context`, `lore_search_context` and `lore_search_memory` give the API 45 s per attempt (`ASSEMBLY_PROXY_LIMITS`), above the 30 s tail Utopia-backed assembly measured on 2026-10-31. ([validated by waits 45s per attempt on /api/context and names 45s in the timeout detail](../../../libs/server-core/src/outbound/proxy.test.ts#L499), [validated by gives the API 45s per attempt](../../../apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L116)) ([validated by gives the API 45s per attempt](../../../apps/mcp-server/src/transport/tools/context/search-context.test.ts#L153), [validated by gives a memory search 45s per attempt](../../../apps/mcp-server/src/transport/tools/memory/search-memory.test.ts#L43))

A timed-out assembly is retried once, two attempts in all. ([validated by retries a timed-out /api/context assembly once, 2 attempts in all](../../../libs/server-core/src/outbound/proxy.test.ts#L518))

Every other proxied call keeps 15 s and four attempts. ([validated by keeps 15s and 4 attempts for a proxied call given no limits](../../../libs/server-core/src/outbound/proxy.test.ts#L533))

## Context builder *(2026-11-03, #4090)*

`/api/context` builds the block from the question instead of from a template the caller picks when the call names `backend: "lore-v2"`; `lore`, `utopia` and `both` keep the template assembly described above. ([validated by accepts backend lore-v2](../../../apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L66), [validated by logs no builder line for backend=lore even when a model is named for context](../../../apps/lore-api/src/transport/routes/context/context.test.ts#L272))

The builder reads Lore's stores only: every question is answered by the template assembly over backend `lore`, so `lore-v2` never reads Utopia. ([validated by assembles from lore when the request names backend=lore-v2 and the settings page says off](../../../apps/lore-api/src/transport/routes/context/context.test.ts#L254))

1,136 real calls (pod transcripts 2026-09-09..10-01, the gateway log 10-25..11-02, laptop sessions) showed that callers mostly pass no template (72% of pod calls), that no assembly comes near its budget (median 1.5–2.5k of 8k tokens), and that docs and spec + tests are the most useful sources for every kind of task while memories and episodes are the least, whatever the template. A query's wording does not tell a review from an implementation either. The block is therefore built in four parts, each from evidence it cites.

### Parts of the block

The block opens with a **repo primer**: what the repository is, its main parts, where its specs, ADRs and tests live, and the rules its `CLAUDE.md`, `AGENTS.md` or `README.md` state. The primer states only what those files say. ([validated by asks the model for a primer from CLAUDE.md alone, telling it to state only what the file says](libs/shared/src/work/context-builder/repo-primer.test.ts#L19))

A repository with none of those files gets the list of its top-level folders as its primer, never a primer written from nothing. ([validated by lists the top-level entries without asking the model when the repository has no CLAUDE.md, AGENTS.md or README](libs/shared/src/work/context-builder/repo-primer.test.ts#L8), [validated by lists apps, libs, README.md and specs once each, sorted](libs/shared/src/work/context-builder/candidate-paths.test.ts#L50))

The primer is written once per default-branch head and reused by every call until the next push to the default branch, whose primer replaces it: one primer is kept per repository. ([validated by writes abc123's primer again after the head moved to def456 and back, keeping one primer per repository](apps/lore-api/src/work/context/primer-cache.test.ts#L38), [validated by writes re-cinq/lore's primer once for two calls at head abc123](apps/lore-api/src/work/context/primer-cache.test.ts#L18), [validated by writes a new primer after a push moves the head from abc123 to def456](apps/lore-api/src/work/context/primer-cache.test.ts#L28), [validated by writes again after a failed write instead of keeping the failure](apps/lore-api/src/work/context/primer-cache.test.ts#L48))

**Key facts** follow: a model writes 3 to 5 factual questions the task needs answered, each answerable from the repository's specs, ADRs, code, tickets and past sessions, and the block carries the answer to each, every fact citing the document, file, ticket or memory it came from. ([validated by answers each of the model's 2 questions from the repository's assembly and returns the block the model writes from that evidence](libs/shared/src/work/context-builder/build-context.test.ts#L58))

Each question is answered from the assembly this spec's engine already runs (the `default` sections of the repository's backend), from up to 6 files the model picks from the repository's file list, and from the spec documents the task names. ([validated by opens each real path the model picks once and never one the repository does not hold](libs/shared/src/work/context-builder/build-context.test.ts#L77), [validated by opens at most 6 of the 8 files the model picks](libs/shared/src/work/context-builder/build-context.test.ts#L90), [validated by ranks the paths sharing most words with the task first and drops paths sharing none](libs/shared/src/work/context-builder/candidate-paths.test.ts#L14), [validated by puts a path the query names first even when it shares no word](libs/shared/src/work/context-builder/candidate-paths.test.ts#L29), [validated by leaves out a named path the repository does not hold](libs/shared/src/work/context-builder/candidate-paths.test.ts#L42), [validated by finds the spec path, FR id and file path a review query names](libs/shared/src/work/context-builder/query-anchors.test.ts#L5))

A question the evidence does not answer is left out of the key facts and named on one closing `Unanswered:` line. ([validated by asks for the closing Unanswered line and quotes of at most 40 words](libs/shared/src/work/context-builder/builder-prompts.test.ts#L27))

An answer that rests on a spec requirement, an ADR or a stated rule quotes its sentence, at most 40 words, instead of paraphrasing it. ([validated by asks for the closing Unanswered line and quotes of at most 40 words](libs/shared/src/work/context-builder/builder-prompts.test.ts#L27))

**Where to look** lists the specs, files (with line ranges where the evidence shows them) and tests the task touches, each with why it matters and the tool that opens it, naming only Lore tools that exist. ([validated by names lore_search_context, lore_search_memory, lore-query-trace and lore_get_ci_failures as the only tools to point at](libs/shared/src/work/context-builder/builder-prompts.test.ts#L15))

It points; it does not copy their content.

**Previous work** lists the issues, pull requests, past sessions and run episodes on the same topic, one line each: what it was, its outcome and the lesson. ([validated by lists memory session-summary/2026-09-28 once when the search found it twice](apps/lore-api/src/work/context/previous-work.test.ts#L5), [validated by cuts a 2000-character memory to 600 characters](apps/lore-api/src/work/context/previous-work.test.ts#L16))

Previous work is found first through what the query names: an issue or pull request number, a spec path, an FR id or a file path. ([validated by reads issue 621 and PR #2154 as numbers](libs/shared/src/work/context-builder/query-anchors.test.ts#L20), [validated by keeps FR-050 and a dotted FR id as they are written](libs/shared/src/work/context-builder/query-anchors.test.ts#L26), [validated by finds nothing in a query that names nothing](libs/shared/src/work/context-builder/query-anchors.test.ts#L32), [validated by looks up issue 621 the query names and hands its text to the write-up](libs/shared/src/work/context-builder/build-context.test.ts#L105))

A topic search of Lore's memories, sessions and episodes adds the rest. ([validated by searches previous work by the model's search terms and the requirements the query names](libs/shared/src/work/context-builder/build-context.test.ts#L118))

For a task that writes (a digest, a changelog, a document), previous work also carries one or two earlier outputs of the same kind as examples of their format and voice. ([validated by asks for earlier outputs as examples when the task writes a digest, changelog or document](libs/shared/src/work/context-builder/builder-prompts.test.ts#L34))

### Repositories it depends on

The repositories a repository depends on are read beside it: every `@re-cinq/*` package in its `package.json` files, and, when cross-repo context is on (the call's `cross_repo` or the repository's `settings.cross_repo`), every repository its `settings.cross_repo_repos` links. ([validated by reads re-cinq/HALEngine and re-cinq/bowman-ui beside re-cinq/Otto, which depends on their packages, without asking the registry about onboarded names](apps/lore-api/src/work/context/related-repos.test.ts#L35), [validated by adds the linked re-cinq/recinq-tms and never re-cinq/Otto itself](apps/lore-api/src/work/context/related-repos.test.ts#L61), [validated by returns the linked repos re-cinq/HALEngine and re-cinq/bowman-ui that settings.cross_repo_repos names](libs/server-core/src/work/context/cross-repo.test.ts#L29), [validated by collects the @re-cinq packages of every manifest once, dev dependencies included](libs/shared/src/work/context-builder/dependency-repos.test.ts#L11), [validated by skips a manifest that is not JSON](libs/shared/src/work/context-builder/dependency-repos.test.ts#L36), [validated by asks re-cinq/HALEngine, which the repository depends on, the task itself and names it to the write-up](libs/shared/src/work/context-builder/build-context.test.ts#L132))

A package is resolved to its repository through the git URL its dependency names, else the `repository` field the registry publishes for it, else an onboarded repository whose name matches the package's; the registry is asked only about a package its dependency and the onboarded repositories do not resolve. ([validated by reads re-cinq/HALEngine and re-cinq/bowman-ui beside re-cinq/Otto, which depends on their packages, without asking the registry about onboarded names](apps/lore-api/src/work/context/related-repos.test.ts#L35), [validated by takes re-cinq/planning-station from a github: dependency](libs/shared/src/work/context-builder/dependency-repos.test.ts#L47), [validated by takes re-cinq/re-lint from the repository field the registry publishes](libs/shared/src/work/context-builder/dependency-repos.test.ts#L59), [validated by matches @re-cinq/hal-engine to the onboarded re-cinq/HALEngine when the registry names none](libs/shared/src/work/context-builder/dependency-repos.test.ts#L71), [validated by resolves an unknown package to nothing](libs/shared/src/work/context-builder/dependency-repos.test.ts#L80), [validated by takes re-cinq/re-lint from the registry's repository field for @re-cinq/eslint-plugin-re-lint](apps/lore-api/src/work/context/related-repos.test.ts#L45))

Evidence about a repository that is neither the task's nor one it depends on is left out of the block. ([validated by forbids a relationship the evidence does not state and evidence about unrelated repositories](libs/shared/src/work/context-builder/builder-prompts.test.ts#L52))

### What the block may state

Every statement in the block is supported by the evidence it was written from. A relationship the evidence does not state (one ticket superseding another, a pull request being the base of a change) is left out or marked as inferred, never stated as fact. ([validated by forbids a relationship the evidence does not state and evidence about unrelated repositories](libs/shared/src/work/context-builder/builder-prompts.test.ts#L52))

### Arguments

Under `lore-v2`, `template` is accepted and ignored, so a caller that still sends it gets the same block.

`max_tokens` caps the block's length, `agent_id` scopes the memories they read, and `cross_repo` adds the repositories in `settings.cross_repo_repos` to those read. ([validated by keeps the block under 900 words at 8000 or 2000 tokens and under 700 words at 1000 tokens](libs/shared/src/work/context-builder/builder-prompts.test.ts#L40))

### Fallback

When the builder cannot run (the Settings page says off, or a model call or a read fails), a `lore-v2` call gets the template assembly over backend `lore`, so a call is never answered with an error the old path could have answered. ([validated by serves the template assembly when no model is named for the context use](apps/lore-api/src/work/context/built-or-assembled.test.ts#L12), [validated by serves the template assembly with the reason when the builder throws](apps/lore-api/src/work/context/built-or-assembled.test.ts#L19), [validated by serves the template assembly when the builder writes nothing](apps/lore-api/src/work/context/built-or-assembled.test.ts#L40), [validated by serves the builder's block as one Context builder section of its 4-chars-per-token size](apps/lore-api/src/work/context/built-or-assembled.test.ts#L30))

The model is the one the org Settings page's Context builder card names in `context_llm_provider` and `context_llm_model`, read on every `lore-v2` call so a change takes effect without a deploy, and it runs on its own vendor, apart from every other model call. ([validated by takes vertex gemini-3-flash-preview from the settings page over the env](libs/shared/src/domain/context-model.test.ts#L5), [validated by builds when the settings page names vertex and the env names nothing](apps/lore-api/src/work/context/context-builder-deps.test.ts#L25), [validated by returns a vertex provider for the context use named vertex gemini-3-flash-preview, the same one on a second ask](libs/shared/src/outbound/llm/llm.test.ts#L90), [validated by builds a new provider when the model moves off gemini-3-flash-preview](libs/shared/src/outbound/llm/llm.test.ts#L99))

A provider saved with no model writes with that provider's default: `gemini-3-flash-preview` on Vertex, `claude-haiku-4-5` on Anthropic. ([validated by gives vertex gemini-3-flash-preview when the settings name vertex and no model](libs/shared/src/domain/context-model.test.ts#L20))

`off` leaves every `lore-v2` call on the template assembly, whatever the env names, and so does a call that names no repository. ([validated by leaves a request that names no repository on the template assembly](apps/lore-api/src/work/context/context-builder-deps.test.ts#L45), [validated by turns the builder off when the settings say off, whatever the env names](libs/shared/src/domain/context-model.test.ts#L27), [validated by leaves lore-v2 on the template assembly when the settings page says off over an env naming vertex](apps/lore-api/src/work/context/context-builder-deps.test.ts#L34))

With nothing saved, the `context` use's env names the model (`LORE_CONTEXT_LLM_PROVIDER`, `LORE_CONTEXT_LLM_MODEL`), and with neither it is Vertex `gemini-3-flash-preview`. ([validated by falls back to LORE_CONTEXT_LLM_PROVIDER and LORE_CONTEXT_LLM_MODEL when nothing is saved](libs/shared/src/domain/context-model.test.ts#L36), [validated by writes with vertex gemini-3-flash-preview when neither the settings nor the env name a provider](libs/shared/src/domain/context-model.test.ts#L48))

The MCP tool gives a `lore-v2` call one attempt of up to 120 seconds, never a retry, because a retry would start a second build.

### Observation

lore-api's `[context] assembled` log line carries the query, so calls can be studied from the API's log without reading pod transcripts. ([validated by carries the query Otto issue 621 reproduction, quoted, after the sections](apps/lore-api/src/transport/routes/context/assembly-report.test.ts#L5))

A block the builder wrote is counted in `lore_context_assembly_total` and logged on the same line as a template assembly, with backend `lore-v2` and its one section `builder`. ([validated by logs backend=lore-v2 sections=builder tokens=3 for a 10-character block](apps/lore-api/src/transport/routes/context/assembly-report.test.ts#L34))

### Acceptance bar

On the ticket-mode context evals the builder scores at least what the template assembly scores in every task category, and a check of the eval's blocks against their evidence finds unsupported statements in under 2% of their factual claims.

## Out of Scope

- Suggesting approaches (directions) for the task, and listing paths already tried and reverted; considered after the parts above are measured in production.
- The retrieval/ranking/XML engine internals — owned by [`context-assembly`](../../context-assembly/spec.md).
- Template authoring (`mcp-server/templates/*.yaml`).
- Vertex AI embedding generation and live Postgres RRF queries.
- Cross-repo transfer scoring (memory/retrieval module).
