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

The mirror only pushes what an ingest sends, so a repo's unchanged specs and ADRs never reach Utopia. `POST /api/repos/{owner}/{repo}/utopia/backfill` reads every spec and ADR CI would ingest at the default branch's head commit and pushes each through the same mirror, setting the repo up first where the deployment may; `scripts/infra/utopia-backfill.sh` runs it for every onboarded repo (specs/utopia-graph-mirror FR7).
