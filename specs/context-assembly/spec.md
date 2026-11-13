# Feature Specification: Context Assembly Templates

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Context Assembly Templates                  |
| Status         | In Progress                                   |
| Created        | 2026-04-03                                  |
| Owner          | Platform Engineering                        |
| Priority       | P2 — Higher value, higher effort            |
| Motivation     | [Zep competitive research](../zep-competitive-research.md) |

Context Assembly Templates add a lore_assemble_context MCP tool that retrieves from all memory sources and formats the result through centrally managed context-block templates, replacing the ad-hoc, inconsistent context each agent used to assemble on its own.

## Problem Statement

Agents call `lore_search_memory` and `get_context` and receive raw text
back. Every agent then assembles its own context: deciding what to
include, how to order it, what format the LLM expects. This is
duplicated work across every agent session, and each agent does it
differently (and usually poorly).

The result: inconsistent context quality, wasted tokens on
irrelevant information, and no way to tune the context format
centrally. When we discover that a certain ordering or formatting
produces better LLM outputs, we have to update every agent's
prompting logic individually.

Zep's approach: **context blocks** — structured templates that
define how retrieved information is formatted before being sent to
the LLM. Context assembly is a separate, explicit step between
retrieval and prompting.

## Vision

A new `lore_assemble_context` MCP tool that takes a query and an
optional template name, retrieves relevant context from all
sources (memories, facts, episodes, graph, repo context), and
returns a single structured block optimized for LLM consumption.
Templates are centrally managed — tune once, every agent benefits.

## User Scenarios & Acceptance Criteria

### Scenario 1: Default Context Assembly

**Actor:** Any agent starting a task

**Flow:**
1. Agent calls `lore_assemble_context(query: "implement auth middleware")`.
2. System retrieves: relevant ADRs, CLAUDE.md conventions, recent
   memories about auth, graph entities for auth-related services,
   relevant PR history.
3. System assembles into structured sections with headers, ordered
   by relevance.
4. Agent receives a single text block ready to prepend to its
   prompt.

**Acceptance Criteria:**
- Single tool call replaces multiple `get_context` +
  `lore_search_memory` + `get_adrs` calls.
- Output is structured with clear section headers.
- Total output fits within a configurable token budget.
- Most relevant information appears first.

### Scenario 2: Task-Type Specific Templates

**Actor:** Pipeline agent executing a review task

**Flow:**
1. Agent calls `lore_assemble_context(query: "review PR #42",
   template: "review")`.
2. The "review" template prioritizes: conventions, ADRs, recent
   review feedback, coding patterns. It deprioritizes: project
   status, team info.
3. Agent receives context tuned for code review.

**Acceptance Criteria:**
- Different templates produce different context orderings and
  selections.
- Templates are defined in a config file, not code.
- Unknown template name falls back to default.

### Scenario 3: Token Budget Enforcement

**Actor:** Agent with a context window constraint

**Flow:**
1. Agent calls `lore_assemble_context(query: "...", max_tokens: 8000)`.
2. System assembles the most relevant context within the budget.
3. Lower-priority sections are truncated or omitted to fit.

**Acceptance Criteria:**
- Output never exceeds `max_tokens`. ([validated by `context-assembly.test.ts@b19f5449`](libs/server-core/src/work/context/context-assembly.test.ts#L130))
- Higher-priority sections are preserved; lower-priority ones
  are trimmed.
- If the budget is very small, only the most essential context
  is returned.

### Scenario 4: Traceable Assembly (Prompt Debug View)

**Actor:** A developer (or platform engineer) debugging why a session got the
context it did, via the web-ui **Assembled** tab.

**Flow:**
1. The tab calls `/api/context?...&debug=1`.
2. Assembly returns, alongside the prompt, a **trace**: per-section status,
   allocated budget, the exact documents pulled (path, type, tokens, relevance,
   ingested date), and the reason any section was omitted.
3. The tab renders inputs + budget summary + per-section trace cards + the prompt
   as a nested `context → section → document` tag tree.

**Acceptance Criteria:**
- A `debug=1` assembly returns a per-section trace carrying each source's status
  and, when omitted, the reason (no results / no rule matched / budget exhausted).
  ([validated by `context-assembly.test.ts@cd15defe`](libs/server-core/src/work/context/context-assembly.test.ts#L290))
- The trace maps 1:1 to a nested `context/section/document` tag tree, dropping
  omitted sections and marking only the last document of a truncated section.
  ([validated by `tag-tree.test.ts@6becdf4e`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/tag-tree.test.ts#L52), [`tag-tree.test.ts@ea7feb34`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/tag-tree.test.ts#L62))
- The debug view renders an included source card and an omitted one with its
  reason, links every contributing document to its context detail page, and shows
  the prompt as the tag tree. ([validated by `AssembledContextView.test.tsx@d5b0a780`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L150), [`AssembledContextView.test.tsx@5398185e`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L187), [`AssembledContextView.test.tsx@951f6efd`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L196), [`AssembledContextView.test.tsx@a4517922`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L222), [`AssembledContextView.test.tsx@5345a0bc`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L235), [`AssembledContextView.test.tsx@10a8c74d`](apps/web-ui/src/app/repos/[owner]/[repo]/assembled/AssembledContextView.test.tsx#L248))

## Functional Requirements

### FR-1: lore_assemble_context MCP Tool

- FR-1.1: `lore_assemble_context(query, template?, max_tokens?,
  repo?, agent_id?)` is the single entry point. ([validated by Tool is visible via MCP listings @6489e722](apps/mcp-server/src/transport/tools/context/assemble-context.acceptance.test.ts#L23))
- FR-1.2: Returns a structured text block with section headers. ([validated by Executes successfully end-to-end @6ebb9cf8](apps/mcp-server/src/transport/tools/context/assemble-context.acceptance.test.ts#L27))
- FR-1.3: `max_tokens` defaults to 16000. Minimum 2000.
- FR-1.4: `template` defaults to "default".
- FR-1.5: *(added 2026-10-16, ADR-052 amendment "reads choose a backend")* `backend` names the store the assembly reads: `lore` (byte-for-byte the assembly above), `utopia` (the default since 2026-10-28) or `both`. Under `utopia` Lore's stores are not read: the `repo` and `adrs` sections are read from the repository's Utopia mirror ([utopia-graph-mirror](../utopia-graph-mirror/spec.md) FR12) and the `memories` and `episodes` sections from Utopia's memory search (FR13.7, added 2026-10-31), the `code` and `coupling` sections from the repository's `test-coverage` source (utopia-graph-mirror FR13.8, added 2026-10-31), and every other section the template asks for is left out of the block, as every section is when the deployment has no Utopia reader or the repository no `settings.utopia`. ([validated by returns a block with no sections when Utopia cannot be read @22d845fe](libs/shared/src/outbound/project/knowledge/context-assembly-backends.test.ts#L8), [validated by returns no sections and reads nothing from Lore for backend utopia with no Utopia reader @86cae1ea](libs/server-core/src/work/context/context-assembly.test.ts#L441))
- FR-1.6: Under `both` the Lore assembly comes first and the Utopia assembly second, each wrapped in a `<backend name="…">` block, each section header prefixed with its store, and each assembled on half the token budget, so the comparison costs what one assembly costs. ([validated by returns Lore's block then Utopia's, each wrapped and each section header prefixed with its backend @7d0e2bb1](libs/shared/src/outbound/project/knowledge/context-assembly-backends.test.ts#L23), [validated by returns Lore's block then Utopia's, each on 4000 of an 8000-token budget, for backend both @1da1a9d9](libs/server-core/src/work/context/context-assembly.test.ts#L462))
- FR-1.7: The backend is the request's when it names one, else the repo's `settings.context_backend`, else `utopia`. ([validated by returns utopia when the request names utopia over a repo set to both @9db2412f](libs/shared/src/domain/knowledge-backend.test.ts#L5), [validated by returns both when the request names none and the repo is set to both @b9720d3f](libs/shared/src/domain/knowledge-backend.test.ts#L9), [validated by returns utopia when neither the request nor the repo names a backend @58978021](libs/shared/src/domain/knowledge-backend.test.ts#L13))
- FR-1.8: `context_backend` is a repo setting (`lore.repos.settings`, no UI yet); `PUT /api/repos/{owner}/{repo}/settings` refuses any value other than `lore`, `utopia` or `both` with 400 before writing. ([validated by returns 400 for a context_backend of dgraph @da123bc6](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L257))

### FR-2: Context Sources

The tool retrieves from all available sources:

- FR-2.1: **Repo context** — CLAUDE.md, project structure
  (from `get_context` logic).
- FR-2.2: **ADRs** — relevant architecture decisions
  (from `get_adrs` logic).
- FR-2.3: **Memories** — agent-specific and shared pool memories
  (from `lore_search_memory` logic).
- FR-2.4: **Facts** — including episode-derived facts
  (from `lore_search_memory` fact search).
- FR-2.5: **Graph** — related entities and relationships
  (from `lore_query_graph` logic, 1-hop). The entities looked up are the
  query's three most distinctive terms, not its first three long words —
  "catalog sync bug: saving" is four long words and no entity. ([validated by `queries the graph for 'settings' and 'lore-api' from 'Add the new settings update for lore-api', not for 'update'` @0f5ca556](libs/shared/src/outbound/project/knowledge/context-assembly-fetchers.test.ts#L78))
- FR-2.5a: **Episodes** — the Recent Episodes section asks memory search for
  episodes as such (`sources: ["episode"]`) rather than filtering them out of
  a mixed top-5, which memories and facts outranked often enough that the
  section came back empty on every call. ([validated by `asks the fact legs for episodes only, never the memories table, and returns the 2 episode rows` @4687da52](libs/shared/src/outbound/project/knowledge/context-assembly-fetchers.test.ts#L48))
- FR-2.6: Each source is retrieved in parallel.
- FR-2.7: **Hybrid relevance ranking.** The local `repo`, `code`, and `adrs`
  sources rank by a Reciprocal-Rank-Fusion of a pgvector cosine leg and a BM25
  (`ts_rank`) leg — the same hybrid that powers `search_context` — so a
  natural-language query surfaces semantically-relevant chunks, not just keyword
  overlap. Degrades to keyword-only (`ts_rank`/`websearch_to_tsquery`) when no
  query embedding is available — and that fallback returns only chunks the
  query matches (`search_tsv @@`), never unmatched chunks ranked by recency: a
  zero `ts_rank` is a score, not a NULL, so without the filter a query matching
  nothing returned the newest chunks of the type, the same three for every
  question, for the four weeks the vector leg was down (2026-08-13 → 09-09). ([validated by `context-assembly.test.ts@ff37b5bf`](libs/server-core/src/work/context/context-assembly.test.ts#L197), [`uses a vector+keyword RRF query when an embedding is available` @431c331d](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L464), [`keyword-only SQL filters with search_tsv @@ websearch_to_tsquery so non-matching chunks are not returned` @3a504fcb](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L341))
- FR-2.8: **No cross-section duplication.** The `repo`/Conventions source pulls
  only `doc`/`spec` (never `adr`, which is its own section), and chunks sharing a
  `file_path` — or a `content_hash`, a file and its copied twin at another path
  being one document — are de-duplicated, keeping the highest-scoring copy; the
  hash rides on every hit for that purpose. ([validated by `context-assembly.test.ts@717dc5ac`](libs/server-core/src/work/context/context-assembly.test.ts#L224), [`context-assembly-format.test.ts@8743bbe0`](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L23), [`context-assembly-format.test.ts@773cf04e`](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L134), [`keeps a path-less item at rank 2 between two keyed survivors instead of moving it last` @6d7a5034](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L140), [`collapses trace-impact-workflow.ts and its twin sharing content_hash abc123 to one item` @a4e9f77f](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L107), [`carries the chunk content_hash onto the item so twins across paths can collapse` @14f948ef](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L355))
- FR-2.9: **Code retrieval.** A dedicated `code` source retrieves
  `content_type='code'` chunks via the same hybrid ranking, so implementation and
  review tasks receive the actual source files they edit (previously code was
  never retrieved — the `repo` source excluded it). ([validated by `context-assembly.test.ts@720938a8`](libs/server-core/src/work/context/context-assembly.test.ts#L251), [`context-assembly.test.ts@225e48ef`](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L275), [`context-assembly.test.ts@04f8e716`](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L422))
- FR-2.10: **Keyword leg searches distinctive terms.** A paragraph-length query
  is reduced to its distinctive terms (stopwords + ≤2-char words dropped, capped)
  for the keyword leg, so common filler words don't dominate ranking. The
  term extraction is one domain helper shared with memory search, so the two
  keyword legs never disagree about what "distinctive" means. ([validated by `key-terms.test.ts@4f424f8a`](libs/shared/src/domain/key-terms.test.ts#L5), [`key-terms.test.ts@3bd83688`](libs/shared/src/domain/key-terms.test.ts#L18))
- FR-2.11: **Normalized relevance.** Item scores are rescaled so the top result
  is `1.00` and the rest are proportional fractions — raw RRF/`ts_rank` scores are
  tiny (~0.02) and unreadable as a relevance signal. ([validated by `context-assembly.test.ts@258ec804`](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L692))
- FR-2.11a: **Similarity travels with a hit.** *(added 2026-10-02)* Both legs of the hybrid search compute the chunk's cosine similarity to the question (`1 - (embedding <=> query)`), and the item carries it as `similarity`. Unlike the normalized score, it compares across sections. A hit the keyword-only fallback found has none. ([validated by carries the cosine similarity 0.74 of a hybrid hit onto the item, and asks both legs for it @0cb3cca1](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L563), [validated by leaves similarity off an item the keyword-only fallback found @e530fc8f](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L604))
- FR-2.11b: **A document is its best three chunks.** *(added 2026-10-02)* Chunks that share a `source_path` are merged into one document at the rank of the best: at most three, their texts joined best first so a cap cuts the least relevant, with the highest similarity of the three. The chunk that matches a question is often the one beside the chunk that answers it (an ADR's Context beside its Decision), and one chunk per document answered such questions from the wrong passage. The search asks for three times as many chunks as it wants documents, so several chunks of one document do not crowd other documents out, and each leg supplies at least as many candidates as the fusion is asked for (never fewer than 20). ([validated by merges the three chunks of adrs/A.md into one document, the best-scoring chunk first @4d6cf24b](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L35), [validated by keeps the best three chunks of a document and leaves the fourth out @b565d5e0](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L70), [validated by keeps three chunks of equal score in the order they arrived @f4a86db8](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L84), [validated by places a merged document where its best chunk ranked @a01510e9](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L94), [validated by keeps one source per source_path, retaining the higher score @8743bbe0](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L23), [validated by keeps a path-less item at rank 2 between two keyed survivors instead of moving it last @6d7a5034](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L140), [validated by asks for 15 chunks when 5 documents are wanted, so several chunks of one document do not crowd the others out @73f989d5](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L591))
- FR-2.11c: **Memories are measured too.** *(added 2026-10-02)* The two vector legs of the memory search return each hit's cosine similarity, the fusion keeps the highest one a hit was measured at, and the memory and episode sources put it on their items, so the relevance cut-off (FR-4.2a) weighs a memory like any chunk. A hit only the keyword leg found was not among its kind's twenty nearest neighbours, so when that vector leg came back full the hit is given the leg's lowest similarity, the most it can be (the fact leg ranks facts and episodes together, so its bound holds for both); when the leg came back short the hit has no embedding and stays unmeasured, and is never cut. Before this the budget the cut-off freed went to memories that shared a common word with the question and nothing else: on the 113 pinned questions the mean context went from 5,128 to 2,854 tokens with as many questions answered (98 before, 100 after), and the share of returned tokens the answer used from 33% to 66%. ([validated by returns the cosine similarity 0.71 the vector leg measured for a memory @a0042841](libs/shared/src/outbound/project/knowledge/memory-search-similarity.test.ts#L40), [validated by gives a keyword-only memory the similarity of the 20th neighbour, 0.61, as the most it can be @1ffc7cfb](libs/shared/src/outbound/project/knowledge/memory-search-similarity.test.ts#L54), [validated by leaves a keyword-only memory unmeasured when the vector leg returned fewer than its 20 @04de8fea](libs/shared/src/outbound/project/knowledge/memory-search-similarity.test.ts#L75), [validated by carries a memory's similarity 0.71 onto its context item, so the relevance cut-off can weigh it @9589a1f5](libs/shared/src/outbound/project/knowledge/memory-search-similarity.test.ts#L138), [validated by keeps the similarity 0.71 of the leg that measured an item the other leg also found @2a7b9c2d](libs/shared/src/domain/memory-ranking.test.ts#L39), [validated by bounds a keyword-only episode at 0.61 by a full fact leg that held only facts: the leg ranks both kinds @249cf295](libs/shared/src/outbound/project/knowledge/memory-search-similarity.test.ts#L110), [validated by keeps a negative similarity of -0.1 when it is the only measurement @c91e4895](libs/shared/src/domain/memory-ranking.test.ts#L45), [validated by leaves similarity off an item no leg measured @4101dbe0](libs/shared/src/domain/memory-ranking.test.ts#L51))
- FR-2.12: **No cross-section duplication.** A document is emitted in its
  highest-priority section only — the same item never appears in two sections
  (e.g. an episode in both Agent Memory and Recent Episodes). Only a section
  that is actually emitted claims its documents: one omitted for budget holds
  nothing back from the sections after it. ([validated by `context-assembly.test.ts@23b356a1`](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L207), [`context-assembly.test.ts@1996557b`](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L220), [`emits a document in Relevant Code when Conventions was omitted for budget` @84e65431](libs/shared/src/outbound/project/knowledge/context-assembly-budget.test.ts#L21))
- FR-2.13: **Repo-scoped graph.** The knowledge-graph source returns only
  entities scoped to the queried repo (no NULL-repo globals), so a task never sees
  another repo's entities.
- FR-2.14: **Repo-bound assembly.** Every source read threads the queried repo —
  the `KnowledgeView` facade and the Pg engine both bind the repo — so a task
  assembles only its own repo's context. ([validated by `assembles context scoped to the repo` @cf0f2575](libs/shared/src/outbound/project/knowledge/knowledge.test.ts#L28), [`knowledge-pg.test.ts@89840890`](libs/shared/src/outbound/project/knowledge/knowledge-pg.test.ts#L113))
- FR-2.15: **Team-schema resolution.** Repo-scoped chunk reads (`repo`, `code`,
  `adrs`, `rules`) resolve the repo's chunk schema — its provisioned team schema,
  else `org_shared` — before querying, matching where reindex actually wrote the
  repo's chunks; the `cross_repo` source runs that same hybrid search once per repo
  linked in settings, each in its own chunk schema. ([validated by `reads from the repo's provisioned team schema instead of org_shared` @0232a91f](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L438), [`retrieves chunks bound to the repo + content types (keyword path when no embedding)` @6ff8340b](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L304), [`cross_repo searches only the linked repos, each in its own chunk schema` @a35d145c](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L628), [`cross_repo without linked repos is disabled and searches nothing` @90da2f03](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L683), [`resolves the repo's team schema when it is provisioned` @678368c8](libs/shared/src/outbound/project/chunks/chunk-schema.test.ts#L66))

- FR-2.17: **Linked repos reach the context.** The default, implementation and
  review templates each carry a `Linked Repos` section on the `cross_repo`
  source, so a request for cross-repo context yields that section in the trace
  instead of nothing. ([validated by `%s carries a cross_repo trace section when crossRepo is requested` @025cbd2b](libs/server-core/src/work/context/context-assembly.test.ts#L381), [validated by `interleaves linked repos by rank, since each repo's scores are normalized on their own` @27575580](../../libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L729))
- FR-2.18: **No linked repos, no cross-repo search.** With no repo linked in
  settings the `cross_repo` section is `disabled` and no chunk query runs; the
  org is never searched. Chunks from a linked repo are not transfer-scored, since
  linking is an explicit opt-in. ([validated by `%s marks cross_repo disabled and never searches chunks without linked repos` @025cbd2b](libs/server-core/src/work/context/context-assembly.test.ts#L398))
- FR-2.19: **The vector leg survives a sparse content type.** HNSW applies the
  repo/`content_type` filter after the index returns its `hnsw.ef_search`
  candidates, so a rare type (ADRs, specs) in a large shared schema could leave
  the vector leg empty and the hybrid silently keyword-only. The hybrid query
  therefore runs in one transaction after a transaction-local `hnsw.ef_search`
  of 200 and, on pgvector 0.8+, `hnsw.iterative_scan = relaxed_order`; the
  vector leg takes its nearest candidates (at least 20) inside the filter, and the number of rows it
  produced rides the fetch result into the debug trace as `vectorLegRows`, so an
  underfilled leg reads as `0` instead of vanishing, and is absent on the keyword-only path, where no vector leg ran. The widened scan is transaction-local and never leaks to the pooled connection. ([validated by `runs the hybrid query in one transaction after widening the HNSW scan, guarded to pgvector 0.8+ for iterative scan` @66608c8f](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L489), [`reports the vector leg's row count from the fused query, 0 when nothing came back` @8d3fd097](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L528), [`carries vectorLegRows 0 onto the trace section of a source whose vector leg came back empty` @117832f9](libs/shared/src/outbound/project/knowledge/context-assembly-budget.test.ts#L141), [`leaves vectorLegRows unset on the keyword-only path` @0cb3cca1](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L563), [`scopes the wide scan to the search's own transaction` @43116500](libs/shared/src/outbound/project/knowledge/context-assembly-chunk-search.contract.test.ts#L143), [`the vector leg returns the few adr chunks among thousands of nearer code chunks` @2932d57e](libs/shared/src/outbound/project/knowledge/context-assembly-chunk-search.contract.test.ts#L129), [validated by returns all 6 ADR chunks from the vector leg among 3000 nearer code chunks @c48f9555](libs/shared/src/outbound/project/knowledge/context-assembly-sparse.acceptance.test.ts#L129))

### FR-3: Template System

- FR-3.1: Templates are YAML files in a configurable directory
  (default: `mcp-server/templates/`). ([validated by `context-assembly.test.ts@43dd808f`](libs/server-core/src/work/context/context-assembly.test.ts#L62))
- FR-3.2: A template defines:
  - `sections`: ordered list of context sections to include.
  - `section.source`: which source to pull from (repo, adrs,
    memories, facts, graph).
  - `section.priority`: 1 (highest) to 5 (lowest). Determines
    truncation order when token budget is tight.
  - `section.max_tokens`: per-section token budget (optional).
  - `section.header`: the section header in the output.
  - `section.filter`: optional filter (e.g., only ADRs with
    status "accepted").
- FR-3.3: The "default" template includes all sources with
  sensible priorities. ([validated by includes sections for repo, adrs, memories, facts, and graph. @556eaf31](apps/mcp-server/src/template-default.acceptance.test.ts#L7), [validated by exists at apps/mcp-server/templates/default.yaml @1d96578b](apps/mcp-server/src/template-default.test.ts#L9), [validated by includes a facts section source @e2e2822e](apps/mcp-server/src/template-default.test.ts#L13))
- FR-3.4: Built-in templates: "default", "review", "implementation",
  "research".

### FR-4: Token Budget Allocation

- FR-4.1: Total budget is divided across sections proportional to
  priority and available content.
- FR-4.2: Empty sections (no results) release their budget to
  other sections.
- FR-4.2a: **Relevance cut-off across sections.** *(added 2026-10-02)* Before the budget is divided, every chunk whose similarity sits more than `RELEVANCE_MARGIN` (0.08) below the best chunk of the whole assembly is dropped, whichever section it is in. A section fills its share with whatever it has, so without this a section with nothing to say about the question still spent a quarter of the budget. A section cut to nothing is omitted with the reason "nothing close enough to the question", and its share goes to the sections that remain. An item with no similarity (a rule, a graph line, a keyword-only hit when the embedder is down) was not measured and is never cut. The margin was measured, not guessed: on 113 questions written from the ADRs and specs of seven repositories and replayed against a copy of production (2026-10-02), the cut-off with three chunks per document took the mean context from 7,465 to 5,128 tokens, the questions answered from 95 to 98, the documents found from 101 to 104, and the share of returned tokens the answer used from 25% to 33%. ([validated by drops the ADR at similarity 0.62 when the best chunk anywhere is at 0.75, and keeps the spec at 0.70 @7a589779](libs/shared/src/outbound/project/knowledge/context-assembly-budget.test.ts#L61), [validated by says why a section whose every chunk fell under the cut-off was left out @ff2e2597](libs/shared/src/outbound/project/knowledge/context-assembly-budget.test.ts#L75), [validated by keeps the best chunk itself, wherever it is, and anything within 0.08 of it @cdc47543](libs/shared/src/outbound/project/knowledge/context-assembly-budget.test.ts#L91), [validated by never cuts an item that carries no similarity, such as a memory or a keyword-only hit @1ac620b1](libs/shared/src/outbound/project/knowledge/context-assembly-budget.test.ts#L107), [validated by gives a cut section's share of the budget to the sections that remain @fed706b8](libs/shared/src/outbound/project/knowledge/context-assembly-budget.test.ts#L119))
- FR-4.3: Token counting uses a simple approximation
  (chars / 4) — no tokenizer dependency. ([validated by `context-assembly.test.ts@8a9f7988`](libs/server-core/src/work/context/context-assembly.test.ts#L34))
- FR-4.4: When content exceeds a section's budget, it is truncated
  at a paragraph boundary with a "(truncated)" marker; content under
  budget is returned unchanged. ([validated by `context-assembly.test.ts@3746253f`](libs/server-core/src/work/context/context-assembly.test.ts#L48), [`context-assembly.test.ts@5428e67e`](libs/server-core/src/work/context/context-assembly.test.ts#L42), [`context-assembly-truncate.acceptance.test.ts@39ccf873`](libs/shared/src/outbound/project/knowledge/context-assembly-truncate.acceptance.test.ts#L5), [validated by truncates at paragraph boundary even when it is below 50% of the character limit @238c6cbd](libs/shared/src/outbound/project/knowledge/context-assembly-items.truncate.test.ts#L5))
- FR-4.5: **Per-document cap.** When a section has more than one document,
  no single document may exceed half the section budget — so one mega-doc
  (e.g. CLAUDE.md) cannot crowd out several smaller, more-relevant chunks. A
  lone document keeps the whole budget. ([validated by `context-assembly.test.ts@541954fa`](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L242), [`context-assembly.test.ts@b67755f3`](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L258))
- FR-4.6: **Minimum document size.** A document that truncation would cut below
  120 tokens is dropped rather than emitted — a one-line stub still costs its
  `<document>` header and tells the reader nothing — and the section is marked
  truncated. Packing continues only when the per-document cap, not the budget,
  was what bound. ([validated by `keeps 2 of 3 documents and drops the third when it would be cut to 40 tokens` @fda8f89d](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L268))

### FR-5: Output Format

- FR-5.1: Output is a single **XML-tagged** string: `<context>` wraps one
  `<section>` per included template section, each wrapping one `<document>`
  per contributing chunk. Provenance lives in tag attributes (`source`, `type`,
  `relevance`, `tokens`, `truncated`); the chunk's own markdown is contained
  inside the tag, so document headings and YAML `---` fences cannot collide with
  the structural skeleton. ([validated by `context-assembly-format.test.ts@f9a41a3f`](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L189), [`context-assembly-format.test.ts@a9afe9bd`](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L163), [`context-assembly.test.ts@00cd099c`](libs/server-core/src/work/context/context-assembly.test.ts#L159), [`context-assembly-format.test.ts@9fe40452`](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L17))
- FR-5.2: Format:
  ```xml
  <context query="…" template="implementation" budget="8000">
    <section name="Architecture Decisions" source="adrs" priority="1">
      <document source="adrs/ADR-016-dark-factory.md" type="adr" relevance="0.83" tokens="640">
      …content…
      </document>
    </section>
  </context>
  ```
- FR-5.3: Empty sections are omitted from output. ([validated by omits empty sections from output @9fb2b6b7](libs/shared/src/outbound/project/knowledge/context-assembly-format.acceptance.test.ts#L5), [validated by `omits a section whose documents array is empty` @322abccc](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L221))
- FR-5.4: A truncated document carries `truncated="true"` rather than an inline
  `...(truncated)` marker. ([validated by `context-assembly-format.test.ts@9fbbaeac`](libs/shared/src/outbound/project/knowledge/context-assembly-format.test.ts#L179))

## Non-Functional Requirements

### NFR-1: Performance

- `lore_assemble_context` returns in under 500ms (parallel retrieval
  from all sources).
- Template loading is cached at startup (not read from disk on
  every call).

### NFR-2: Observability

- Debug mode (`debug=1`) returns a full assembly trace: per-section status,
  allocated budget, raw vs final tokens, truncation, omit reason, and the
  contributing documents with provenance. ([validated by `context-assembly.test.ts@cd15defe`](libs/server-core/src/work/context/context-assembly.test.ts#L290))
- Audit log records each `lore_assemble_context` call with: query, template used,
  sources hit, total tokens returned. *(Audit-log persistence is tracked as
  follow-up — the in-memory trace lands first.)* ([validated by Logging captures call variables: query, template used, sources hit, total tokens returned @d6a012fb](apps/mcp-server/src/transport/tools/context/assemble-context.acceptance.test.ts#L45), [validated by logs query, template, sources hit, and tokens to console.error after a successful proxy call @52eddb06](apps/mcp-server/src/transport/tools/context/assemble-context.test.ts#L74), [validated by Logs the resolved template used after unknown-name fallback @b4cf8bfc](apps/mcp-server/src/transport/tools/context/assemble-context-fallback.acceptance.test.ts#L23))
- **Embedder health is a value, not a log line.** The embedding service keeps
  `{ lastOkAt, lastFailureAt, lastStatus, consecutiveFailures }`: a refused
  Vertex call records its HTTP status, a call that never reached Vertex (no
  credential, no project, network) records `null`, and one success resets the
  streak. Three failures in a row is *degraded*. A degraded embedder prepends a
  keyword-only warning to the assembled block — the agent reading it should
  know semantic matches and memory search are missing — and the debug trace
  carries `embedderDegraded`. ([validated by `reports consecutiveFailures 2 and lastStatus 403 after two 403 responses` @5e7cac27](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L55), [`embedding-service.test.ts@65a40906`](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L69), [`embedding-service.test.ts@b75ffd27`](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L90), [`context-freshness.test.ts@b2050df9`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L7), [`context-freshness.test.ts@20a62002`](libs/shared/src/outbound/project/knowledge/context-freshness.test.ts#L20))

## Scope Boundaries

### In Scope

- `lore_assemble_context` MCP tool.
- Template YAML format and built-in templates.
- Token budget allocation.
- Parallel retrieval from existing sources.

### Out of Scope

- LLM-based summarization within assembly (just retrieval +
  formatting, no additional LLM calls). *(Amended 2026-11-03, #4090: the
  engine itself still makes no model call, and backends `lore`, `utopia`
  and `both` serve it as before. Only a call naming backend `lore-v2` gets
  the [context builder](../mcp-tools/assemble-context/spec.md#context-builder-2026-11-03-4090),
  which asks a model for the task's questions, answers each with this
  engine's `default` sections over Lore's stores, and writes the block; a
  `lore-v2` call gets this engine's output when the builder cannot run.)*
- Dynamic template selection based on query analysis. *(Amended 2026-11-03,
  #4090: not added. Callers no longer choose a template at all; `template`
  is accepted and ignored for one release, then removed.)*
- Template management UI.
- Template versioning.

## Dependencies

- Episode ingestion (episodes as a fact source).
- Live knowledge graph (graph as a context source).
- Existing `get_context`, `get_adrs`, `lore_search_memory` logic
  (reused internally, not replaced).

- FR-2.16: **Coverage links stripped.** The `([validated by …](…), …;
  implemented by …)` groups that spec-test-coverage v3 appends to statements
  are removed from every chunk before it is ranked into the bundle and before
  it is embedded at ingest; the stored chunk keeps them for the coverage
  validators. A heavily backfilled statement is mostly test paths — hundreds
  of "test", "lib", "src" tokens that keyword-match every question and spend
  the embedding window on bookkeeping. ([validated by `returns a Conventions item of 10 tokens for a chunk whose 120-char link group was stripped` @1b379a82](libs/shared/src/outbound/project/knowledge/context-assembly.test.ts#L388), [`spec-link-strip.test.ts@f61864de`](libs/shared/src/domain/spec-link-strip.test.ts#L38), [`spec-link-strip.test.ts@5c624236`](libs/shared/src/domain/spec-link-strip.test.ts#L46), [`spec-link-strip.test.ts@725704cf`](libs/shared/src/domain/spec-link-strip.test.ts#L57), [`spec-link-strip.test.ts@2f46644c`](libs/shared/src/domain/spec-link-strip.test.ts#L65), [`ingest.test.ts@4a30feec`](apps/lore-api/src/work/spec-trace/ingest.test.ts#L204), [`strips the same 4 fixtures the JS stripper strips, once read as a JS regex` @2ee9b592](libs/shared/src/domain/spec-link-strip.test.ts#L74), [`is carried verbatim by migration 0070 and both baseline schema scripts` @d891c481](libs/shared/src/domain/spec-link-strip.test.ts#L80))
## Success Criteria

1. A single `lore_assemble_context` call replaces 3+ separate MCP
   tool calls for agents starting a task.
2. The "review" template produces measurably more relevant context
   for code review tasks than the generic `get_context` call.
3. Token budget is respected — output never exceeds the requested
   limit.
4. Adding or modifying a template requires only a YAML file
   change, no code changes.
5. Context assembly latency stays under 500ms despite hitting
   multiple sources.
