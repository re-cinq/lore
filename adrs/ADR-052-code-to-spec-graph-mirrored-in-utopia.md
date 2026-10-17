---
adr_number: 52
title: "The spec-to-code chain is mirrored into Utopia on every ingest"
status: draft
date: 2026-10-15
deciders: ["Bogdan Szabo"]
domains: [spec-trace, ingest, lore-api, utopia, infrastructure]
---

# ADR-052: The spec-to-code chain is mirrored into Utopia on every ingest

This ADR records that the chain Lore draws from a repository's documents — spec or ADR, its sections, their statements, the tests that validate them and the code that implements them — is written into Utopia (deeplethe/utopia, the knowledge-graph service deployed beside Lore under `enable_utopia`) by lore-api on every spec and ADR ingest, one knowledge base per repository, under the Lore ontology. Dgraph stays the store Lore's own checks read.

## Context

Dgraph's retirement is decided: the traceability graph it holds is read by the spec pages, the spec-upkeep detectors and the ingest routes, and nothing else, while the cluster pays for a store with its own schema scripts (`scripts/infra/setup-spec-trace-schema.sh`) and its own transaction aborts on every concurrent projection. Utopia already runs in the cluster for its own reasons, keeps a typed knowledge graph, and answers questions over it.

A spike on 2026-10-14 pushed a hand-built sample of the chain into a Utopia knowledge base and read it back. What it found:

- **Entity typing is deterministic once the kind words are bound.** An entity arrives as `[name, kindWord, true]`; after `POST /kbs/{kb}/review/alignment/kind-words/{word}` has bound each word to a class of the imported ontology, every pushed entity lands typed, with no review queue to clear. The class keys are the snake_case of the class labels.
- **Relations stay open until an upstream typing change.** A statement's phrase (`validated_by`, `contains`) is stored as written but not resolved to the ontology's object property, so a read cannot yet ask "every `validated_by` edge" by property; it asks by phrase. Utopia has the change on its list; the mirror writes the phrases as the property labels so nothing needs re-pushing when it lands.
- **Two reads Utopia lacks.** Its read API returns no qualifiers, and it has no negation (a statement that something is *not* validated). The spec-upkeep detectors need both (the line anchor of a link travels as a qualifier today; "unlinked" is a negation), so they keep reading Dgraph for now.
- **Names resolve by lower-cased text**, and a name that is a substring of another same-class name is flagged as a duplicate. So every name carries the repository and the path, and a statement is named by its ordinal, never its text.
- **Limits**: 200 statements and 64 KiB per push, 422 past either.

## Decision

- **lore-api mirrors every spec and ADR it ingests**, after the Dgraph projection and never instead of it: the delta route's doc kinds call the mirror for each projected file and tombstone each deleted one. The mirror's failure is logged, counted (`lore_utopia_mirror_failures_total`) and swallowed; the ingest answers from what the graph did.
- **One knowledge base per repository, named `owner/repo`**, in the workspace of the person who sets it up, carrying the Lore ontology (`libs/shared/src/domain/lore-ontology.ttl`): Document contains Section contains Statement; Statement `validated_by` Test, `implemented_by` SourceFile, `decided_by` Adr; Test carries title, path, line and permalink.
- **The push key lives in its own table, `lore.utopia_sources`**, one row per repo, readable by the `lore` role alone and answered by no route. It stays out of `lore.repos.settings`, which the repo read routes serve whole at read scope, and which holds only the knowledge base id, the source id and the ontology version. It is a per-source key: it can push to that one source of that one knowledge base and read nothing. Utopia hands it out once, at the source's creation, so setup keeps a source only while the table holds its key.
- **A setup route does the ceremony**: `POST /api/repos/{owner}/{repo}/utopia/setup`, admin scope, with a person's Utopia session token and workspace id in the body — find or create the knowledge base, import the ontology, bind the ten kind words, create the `lore` statements source unless settings hold one — saves the key to the table and the ids to the settings block. It answers the ids and never the key.
- **The builder is pure** (`libs/shared/src/domain/utopia/doc-statements.ts`): the same parsers the spec pages and the lint use (`linksForStatements`, `parseCodeLinksInStatement`, `segmentStatements`) give it the statements, their sections and their links, so Utopia's chain and Lore's own never disagree on what a statement is.

## Consequences

- Dgraph is not retired by this ADR. The spec pages, the detectors and `query_trace` keep reading it until Utopia answers qualifiers and negation; the mirror runs beside it so the data is there the day they switch.
- A statement item's id is its ordinal, so inserting a statement above another renumbers everything below it on the next push. Utopia reports those as `updated`, which is correct and cheap; the cost is in reading history, which nothing does yet.
- A deleted document leaves its statement items standing: the delta names only the path, and the ordinals it was last pushed with are not stored. Only the `doc:` item is tombstoned.

## Later slices

1. Store the ordinals of the last push per document so a deletion tombstones every item.
2. Push tests from the test ingest (`lore-code-trace`) so a Test entity carries `covers` with its line ranges, and code definitions from the code projection.
3. Switch the spec pages to read Utopia once relations resolve to properties; then the detectors; then retire Dgraph.

## Amendment 2026-10-15: Lore creates the base itself on a repo's first ingest

Lore creates the base itself once Utopia accepts a write token, deeplethe/utopia#1244; until that ships the flag stays off.

The setup route needs a person to paste a Utopia session token, so a repo stays unmirrored until someone runs it. With #1244, a personal access token with `write` scope (`utp_pat_…`) calls the same setup routes as its owner, and the requests are byte for byte the ones a session makes. So:

- **The client's setup surface takes any bearer** (`withCredential`): a session JWT from the route, or the deployment's token.
- **A "Lore" person in Utopia**, workspace admin of the workspace Lore's bases live in, holds the token. lore-api reads it as `UTOPIA_TOKEN` (GCP secret `lore-utopia-lore-api-token`, mirrored by ESO into `utopia-token` in `lore-api`) and the workspace as `UTOPIA_WORKSPACE_ID`, both set only under terraform's `enable_utopia_auto_setup`.
- **The first mirrored ingest of a repo that is not set up runs the setup**, through the same function and the same writer as the route, then mirrors. Two ingests in one process share one setup; across processes the base is found by name and the source row is one per repo, so the source saved last wins. A failed setup is a failed mirror: logged, counted, never an ingest failure, and tried again on the next document.
- **The route stays**, for a deployment that holds no token, and to set a repo up in another workspace by hand.

## Amendment 2026-10-15: a backfill for documents ingested before the mirror

The mirror only pushes what an ingest sends, so a repo's unchanged specs and ADRs never reach Utopia. `POST /api/repos/{owner}/{repo}/utopia/backfill` reads every spec and ADR CI would ingest at the default branch's head commit and pushes each through the same mirror, setting the repo up first where the deployment may; `scripts/infra/utopia-backfill.sh` runs it for every onboarded repo (specs/utopia-graph-mirror FR7). The stations service also runs it weekly, Sundays at 02:30 UTC, one repo at a time with the stations' own lore-api token, skipping a repo that is not set up and stopping where the deployment has no Utopia (FR7.7–FR7.12).

## Amendment 2026-10-15: the prose of specs and ADRs is mirrored

Asked about dark factories against `re-cinq/lore`, Utopia's chat found the right statement items and answered that nothing explained them: each item held names, ids, line numbers and permalinks, and the pushed statements are the chunk Utopia searches and cites. So the words now travel with the structure:

- **Ontology version 2** declares `text` (Section, Statement) and gives Document a `title`. Each Statement carries its words with the coverage links stripped and whitespace collapsed, cut at 4,000 characters; each Section its heading; each Document its first top-level heading. A split statement carries its text on its first item only.
- **A base set up under version 1 is upgraded on its next ingest**, where the deployment holds a Utopia token: the ontology is re-imported, the kind words bound, the version stored, then the push goes ahead. Without a token the push goes ahead anyway and the text lands as open attributes. A failed upgrade is a failed mirror, never a failed ingest.
- **Code text is still not copied.** A source file is linked by path; the chain says which code implements a statement, and the code itself is read from the repository.


## Amendment 2026-10-16: test runs and coverage are mirrored

The mirror carried specs and ADRs, so Utopia knew which tests a statement names but not whether they ran, passed, or what code they touched. Now, after the delta route has projected a default-branch test report into the graph, lore-api pushes the same run (specs/utopia-graph-mirror FR9):

- **One `test:<path>` item per test file**, split past the 200-statement limit as a statement is. Each Test carries `title`, `path`, its lines, a `permalink` and the `commit`, and an `outcome` when it ran.
- **The statements its spec links name are `validated_by` it when it passed and `violated_by` it when it failed.** The outcome is the phrase, never a qualifier: Utopia keeps the qualifiers a relation was first written with, so a `passed` qualifier would stay on a test that later failed. Utopia's ADR 0070 (deeplethe/utopia#1278) proposes otherwise.
- **A test `covers` each source file its run covered**, qualified by `lines` and `commit`. Until Utopia replaces qualifiers on a re-push, those two are informational: they say what the first run covered.
- **A deleted test file is tombstoned** after the graph prunes it.
- **A branch's report is not mirrored.** It goes to its overlay in the graph; a statement in Utopia is validated by main's tests only.
- **`lore-code-trace` chunks a report by test file**, so a chunk never carries part of a file and replaces that file's item with the part.
- **Ontology version 3** declares the words these items use; a base on an older version is upgraded on its next mirrored ingest, as before.

A failed push is a failed mirror: logged, counted, never a failed ingest.

## Amendment 2026-10-16: trace reads go through the trace port

Slice 3 swaps the store behind Lore's graph reads, so those reads should meet the graph at one seam. Three of them held a Dgraph client of their own: the `/trace` kinds `failures-touching` and `callers`, and the `coupling` source of context assembly. They now read through `TracePort`:

- **The failure reader moved to the outbound tier** (`libs/shared/src/outbound/spec-trace/failure-reads.ts`), unchanged, because `outbound` may not import `work`; `libs/shared/src/work/spec-trace/failure-nodes.ts` re-exports it and keeps the writes.
- **The port gained `failuresTouching`, `callers` and `graphContext`.** `DgraphTrace` answers each by calling the function that answered it before, so the queries and the answers are the same. The route reads both kinds through the Project's trace view, and the coupling source takes any `graphContext` reader, which the context route and the context evals build with `traceFromEnv(process.env)`.
- **A deployment with no graph composes `NoGraphTrace`**: no failures, no callers and an empty context block, as before; the document reads refuse with the message the graphless stub threw.
- **A Utopia adapter plugs in behind `providers.trace`**, which `createProject` prefers over the Dgraph adapter.

The impact routes and the cross-repo spec and ADR listings still hold a client. Their readers live in `work/`, and they move when those readers do.

## Amendment 2026-10-16: reads choose a backend

Before any read moves to Utopia, Lore and Utopia run side by side, so that what each returns for the same question can be compared:

- **Every ingest writes to both.** The spec and ADR mirror above is the first; each other source follows as its Utopia writer lands. Lore's stores stay the default answer.
- **A read names its backend: `lore`, `utopia` or `both`** (`KnowledgeBackend`, `libs/shared/src/domain/knowledge-backend.ts`). `GET /api/context`, `GET /api/search-context`, the `search` action of `POST /api/memory`, `POST /api/context-evals` and the MCP tools `lore_assemble_context`, `lore_search_context` and `lore_search_memory` take an optional `backend`; context assembly falls back to the repo's `settings.context_backend`, then to `lore`. An unknown backend is a 400.
- **No silent fallback.** A source with no Utopia reader answers `<source>: no Utopia reader yet` in Utopia's place, never Lore's data under Utopia's name; a search tool the MCP adapter would answer offline refuses `utopia` and `both` rather than read Lore's stores. `both` puts Lore's assembly first and Utopia's second, each section labelled with its store and each on half the token budget.
- **No source has a Utopia reader yet.** They land one source at a time behind this switch; the context evals grade one backend per call, and scoring `both` side by side is a following change.

## Amendment 2026-10-16: code links are mirrored

The code ingest already parses every TypeScript and JavaScript file of a default-branch `code` delta into its top-level definitions, what each calls and what the file imports. After the graph has the delta, the same parse is pushed to Utopia, closing the chain from a statement's `implemented_by` source file down to the definitions in it:

- **One `code:<path>` item per source file**, split past the 200-statement limit as a statement is. Repository `contains` the SourceFile, which carries its `path`, `commit` and `permalink`.
- **Each top-level definition is a `CodeDefinition` named `owner/repo:<path>#<symbol>`**, which the SourceFile `defines`, with its `symbol`, `line_start`, `line_end` and a permalink to its lines.
- **A definition `references` what it calls** in the same file, and what it calls through a named import from a relative path, resolved against the importer's directory with a `.js` path read as the importer's own extension. The SourceFile `imports` each such file.
- **Not linked:** imports from packages, which name nothing in the repository, and calls to names neither defined nor imported in the file. **Not copied:** the text of the file; a definition is a name, its lines and a permalink.
- **A file the graph skips for its size is skipped here too**, and a deleted or pruned file is tombstoned after the graph removes it.

The ontology declared these words in version 1, so no upgrade is needed. A failed push is a failed mirror: logged, counted, never a failed ingest.

## Amendment 2026-10-16: commit history under ontology version 4

The chain said what a repository's documents, tests and code are and nothing about when each changed. Now the default branch's commits are mirrored too (specs/utopia-graph-mirror FR12):

- **Four classes and five event relations.** `Commit` `changes` the Spec, Adr or SourceFile it touched, `follows` its parents and `merges` the `PullRequest` its squash subject names; the pull request `closes` each `Issue` its body claims to resolve, `refers_to` each it only names (`Refs`, the partial footer) and `delivers` the `Task` of its `Lore-Task:` line. A commit, a pull request and an issue are named as their GitHub page's path, so `https://github.com/<name>` is each one's permalink and a pull request and an issue with one number stay apart.
- **The commit item names paths, never what changed inside them.** CI pushes a commit's tests and definitions after the merge, and Utopia merges same-named entities whichever item came first, so the commit's `changes` and the later test-report item's `contains` meet on one SourceFile. Order does not matter and nothing is re-pushed; what a commit touched inside a file is a walk through the file.
- **A cursor, not a delta.** lore-api walks the branch above `settings.utopia.commits_head`, oldest-first, 2,000 commits a walk, and moves the cursor past each commit that landed whole, so the whole history arrives over as many walks as it takes and a failed push is retried by the next. The walks of one repo run one after the other in a process, so a push during a walk cannot move the cursor back, and the settings writer merges into the `utopia` block so a setup or an upgrade keeps the cursor. The weekly backfill runs the walk after the documents; the stations post it on every push, through a route that skips any branch but the default one.
- **Every relation now says its temporal.** Utopia binds a pushed phrase by the declaration alone (deeplethe/utopia#1242) only when the relation is not a state, and its importer gave every imported relation `state`: the test-run amendment's hope that the phrases would bind without re-pushing was wrong, and every Lore relation has waited on the model-driven aligner. The turtle now marks the structural relations `eternal` and the commit relations `event`, holding at the item's `doc_time`, the author date; deeplethe/utopia#1291 teaches the importer to read the annotation on create and on re-import, so the version-4 upgrade of a live base flips its relations. Attributes still go to the aligner, since the rule reads no literal object.

## Amendment 2026-10-16: the first Utopia reader is search over the mirrored statements

The context evals count a question as found when the assembly kept the document it was written from, and they use the `default` template, whose `repo` and `adrs` sections hold specs and ADRs. Those are already mirrored as statement items, so the first reader is a search over them, not a graph read:

- **One search per assembly** of the repository's knowledge base, 50 hits, and a second page only for a section the first left short. The hits of the statements source that are doc or statement items become one item per document: its title, then its statement texts in order, under the path Lore uses. Everything else still answers `<source>: no Utopia reader yet`.
- **The same pipeline as Lore's.** A store answers a section through a reader; budget, serialization and the debug trace are shared, so an eval grades Utopia's assembly the way it grades Lore's.

Caveats, each waiting on upstream:

- A tombstoned document may still match a search until Utopia can exclude missing documents.
- Search has no source filter, so a hit of another source is dropped after it is returned, and fills the page that a statements hit could have used.
- A code item carries no text yet, so the `code` section keeps no reader.
- Typed graph reads (coupling, violated statements) wait for Utopia re.8, whose importer types the relations the ontology declares.

### Revision 2026-10-17: a commit item carries no file list, and history starts 200 commits back

Utopia resolves every entity a pushed item names against the whole knowledge base, so a commit touching forty files cost forty resolutions, and on 2026-10-17 its queue grew faster than its database, sized up to four CPUs, could drain it. A commit item now carries only the commit's words, author, time, parents and links to its pull request, issues and task; `changes` stays declared in the ontology and no item pushes it. A walk takes the newest 200 commits above the cursor from GitHub's commit listing, with no read per commit: a repo's history in Utopia starts 200 commits before its first walk, and later commits arrive through the push handler as they land.
