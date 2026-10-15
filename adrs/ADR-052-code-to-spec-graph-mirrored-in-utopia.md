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
- **The push key lives in the repo's settings** (`lore.repos.settings.utopia.source_key`), as the floor's and the digest's per-repo configuration does. It is a per-source key: it can push to that one source of that one knowledge base and read nothing. Utopia hands it out once, at the source's creation, so setup keeps a source it finds in settings.
- **A setup route does the ceremony**: `POST /api/repos/{owner}/{repo}/utopia/setup`, admin scope, with a person's Utopia session token and workspace id in the body — find or create the knowledge base, import the ontology, bind the ten kind words, create the `lore` statements source unless settings hold one — and writes the settings block. It answers the ids and never the key.
- **The builder is pure** (`libs/shared/src/domain/utopia/doc-statements.ts`): the same parsers the spec pages and the lint use (`linksForStatements`, `parseCodeLinksInStatement`, `segmentStatements`) give it the statements, their sections and their links, so Utopia's chain and Lore's own never disagree on what a statement is.

## Consequences

- Dgraph is not retired by this ADR. The spec pages, the detectors and `query_trace` keep reading it until Utopia answers qualifiers and negation; the mirror runs beside it so the data is there the day they switch.
- A statement item's id is its ordinal, so inserting a statement above another renumbers everything below it on the next push. Utopia reports those as `updated`, which is correct and cheap; the cost is in reading history, which nothing does yet.
- A deleted document leaves its statement items standing: the delta names only the path, and the ordinals it was last pushed with are not stored. Only the `doc:` item is tombstoned.

## Later slices

1. Store the ordinals of the last push per document so a deletion tombstones every item.
2. Push tests from the test ingest (`lore-code-trace`) so a Test entity carries `covers` with its line ranges, and code definitions from the code projection.
3. Switch the spec pages to read Utopia once relations resolve to properties; then the detectors; then retire Dgraph.
