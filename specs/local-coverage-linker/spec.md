# Feature Specification: Local Coverage Linker (BYO-Compute)

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Local Coverage Linker (BYO-Compute)      |
| Status         | Draft                                    |
| Created        | 2026-06-02                               |
| Owner          | Platform Engineering                     |
| Depends on     | [`spec-test-coverage`](../spec-test-coverage/spec.md) (v2 statement-level linker) |

## Problem Statement

The spec → test linker ([`agent/src/jobs/cron/spec-test-linker.ts`](../../agent/src/jobs/cron/spec-test-linker.ts))
runs server-side on GKE and bills its LLM work against
`ANTHROPIC_API_KEY`. Three pain points:

1. **Double billing.** Developers with Claude Code Pro/Max already pay
   for inference; the cron + post-ingest fan-out pays again for the
   same reasoning class. For an org with frequent spec/test churn the
   cron's bill is real (classifier fallback × N statements + judge ×
   N candidates per spec, weekly + on-ingest).
2. **No in-the-loop curation.** The classifier-fallback and the
   statement-level judge produce arguable decisions whose rationales
   would benefit from a human eye. Today the cron commits whatever it
   produces; nothing in the loop catches a borderline call until a
   reader hovers a popover in the UI.
3. **No on-demand path.** A developer who just edited a spec must
   wait for the post-ingest webhook (if the GitHub Actions ingest
   even ran) or Monday's sweep before the UI updates. Mirroring the
   [`local-task-runner`](../local-task-runner/spec.md) pattern, the
   developer's own Claude session is the cheapest, most up-to-date
   reasoner — it just doesn't have the tools to do it yet.

## Solution

A **BYO-compute** linker mode. The LLM-y parts (classifier fallback,
statement-level judge, optional assertion extraction) move into the
developer's local Claude Code session over MCP. The deterministic
parts (segmentation, heuristic, candidate pre-filter, argmax dedup,
threshold, persistence, hash gate) stay server-side so the local
session **cannot** pollute the DB even if the developer is sloppy or
malicious.

Two MCP tools drive the round-trip:

- **`prepare_spec_link(repo, spec_path)`** — server returns the
  reassembled spec, deterministically segmented statements, the
  cheap section-heuristic classification, the pre-filtered candidate
  tests, and the current content hash. Pure, no LLM call.
- **`persist_spec_link(repo, spec_path, content_hash, classifications,
  judgments)`** — server validates the hash, validates every ordinal
  the developer references exists in the prep'd statement set,
  validates every score is in `[τ, 1]`, applies `argmaxByTest()` for
  best-match-per-test, then writes `spec_statements`,
  `spec_test_links` (with `statement_ordinal`/`statement_text`/
  `match_score`), and `spec_coverage_runs` (with a new `linked_by`
  attribution column).

A third tool, **`list_stale_spec_coverage(repo)`**, helps the
developer pick what to work on (specs whose current hash ≠ last linked
hash, or never linked).

A skill, **`/lore-link-coverage`**, drives the flow conversationally.

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Compute split | **Deterministic on server, LLM on client.** Segmentation, heuristic, candidate pre-filter, argmax, threshold, persistence — server. Classifier fallback + judge — local Claude. | Server-side validation is the trust boundary; a hostile client can't pollute the DB. Determinism contract for `(ordinal, text)` is preserved because the segmenter never moves. |
| Round-trip shape | **One spec per `prepare` → `persist` pair.** No batch. | Keeps the conversation focused, makes hash-mismatch retries cheap, matches how a human reasons one spec at a time. Sweep is a `list_stale` → loop. |
| Auth scope | **Reuse existing `write` scope** (no new `coverage:write`). | If `write` is compromised, the blast radius is already org-wide; a finer scope adds infra without changing the threat model. |
| Cron coexistence | **No locking; rely on the existing content-hash gate.** | Human and cron converge against the same hash. Whichever sets it last wins; the other no-ops on its next pass. A `claimed_by` lease is a v2 follow-up if real contention shows up. |
| Server-side enforcement | **`argmaxByTest()` + τ=0.5 threshold + ordinal-validity check applied server-side on persist.** | A developer cannot ship a malformed link by hand (wrong ordinal, score=2.0, multiple statements per test). |
| `extractAssertions` | **Stays agent-side for v1.** Cached results, if present, are returned in `prepare` as `assertion_hints` for the client to use. | Scope cap; moving it would mean writing an additional MCP tool, and the per-call cost is modest. v2 moves it to the local Claude. |
| Attribution | **`spec_coverage_runs.linked_by`** column records `cron` / `webhook` / `local:{agent_id}`. | Analytics; UI can show "last linked 2h ago by jbloggs"; lets us measure BYO-compute adoption. |
| Failure semantics | **Hash-mismatch `prepare`/`persist` round-trip → 409 CONFLICT; client retries `prepare`.** | Spec drift mid-conversation is rare but real (someone else ingested while you reasoned). Returning 409 forces a clean re-segmentation. |
| Local stdio MCP proxy | **The three new tools proxy to `LORE_API_URL`** just like memory tools do. | Lets a developer's local Claude Code session write to prod through the same path they read from. |
| UI surface | **A small "linked 2h ago by {who}" subline** on `SpecCard` when `linked_by != 'cron'`. | Visible signal that BYO-compute happened. Optional; coverage math is unaffected. |

## User Experience

### The skill flow

```
$ /lore-link-coverage re-cinq/lore

> I'll check which specs in re-cinq/lore need linking.
  [tool: list_stale_spec_coverage("re-cinq/lore")]

  3 specs need attention:
    1. specs/local-task-runner/spec.md — hash changed 2h ago
    2. specs/dark-factory/spec.md — 84 statements outdated
    3. specs/scheduled-job-runtime-split/spec.md — never linked

  Want me to work through all three, or pick one?

$ 1

> [tool: prepare_spec_link("re-cinq/lore", "specs/local-task-runner/spec.md")]

  24 statements segmented:
    • 8 marked untestable by the section heuristic
      (intro / limitations / clarifications)
    • 16 need a classifier decision
    • 14 candidate tests pre-filtered (no truncation)

  Classifying the unknowns...

  Statement 4 ("It claims a pending task before GKE picks it up.")
  → testable
  Statement 5 ("If the task is already taken, it backs off and
  re-polls every 30 seconds.")
  → testable
  ... (14 more)

  Judging tests against statements...
  Test `runner.test.ts › claims pending task before GKE` → best
  match is ordinal 4 (Returns true), score 0.86, rationale
  "exercises the SKIP LOCKED claim query against pipeline.tasks".
  ... (8 more matches; 5 candidates rejected as no-match)

  [tool: persist_spec_link(repo, spec_path, content_hash,
                            classifications, judgments)]

  ✓ Saved.
  View: https://lore.example.com/repos/re-cinq/lore/specs

  Continue to spec 2?
```

### Web UI: small attribution touch

The `SpecCard` keeps the same `CoverageBar` and caption from
[`spec-test-coverage`](../spec-test-coverage/spec.md). Below the
caption, a single line — shown only when `linked_by != 'cron'` —
reads:

```
linked 2h ago by you (local)
```

…or `linked 2h ago by alice (local)` when the bar shows another
developer's run. Cron-linked specs render no subline (the default
state, no extra noise).

The details page (`/specs/[...path]`) gets the same subline above the
`CoverageBar` header.

## Architecture

```
┌─────────────────────────  Local Claude Code session  ─────────────────────────┐
│  /lore-link-coverage skill                                                     │
│      │                                                                          │
│      ├── list_stale_spec_coverage(repo)         → stdio MCP → LORE_API_URL     │
│      ├── prepare_spec_link(repo, spec_path)     → stdio MCP → LORE_API_URL     │
│      │     ⇣                                                                    │
│      ├── (Claude reasons in-conversation: classifier fallback + judge)         │
│      │     ⇣                                                                    │
│      └── persist_spec_link(repo, ...)           → stdio MCP → LORE_API_URL     │
└────────────────────────────────────────────────────────────────────────────────┘
                                       │ HTTPS
                                       ▼
┌──────────────────────────  GKE mcp-server  ───────────────────────────────────┐
│  GET  /api/repos/:o/:r/spec-coverage/stale          (read scope)               │
│      reassembleSpec()+hashSpecContent() per spec; join spec_coverage_runs;     │
│      filter where hashes differ or row missing                                 │
│                                                                                │
│  POST /api/repos/:o/:r/spec-coverage/prepare        (read scope)               │
│      reassembleSpec → segmentStatements → buildIntroOrdinals →                 │
│      classifyByHeuristic → selectCandidates → hashSpecContent                  │
│      → return { spec, statements (heuristic), candidate_tests,                 │
│                   content_hash, assertion_hints? }                              │
│                                                                                │
│  POST /api/repos/:o/:r/spec-coverage/persist        (write scope)              │
│      validate content_hash unchanged (else 409)                                │
│      validate every classifications[*].ordinal ∈ segmenter output              │
│      validate every judgments[*].statement_ordinal ∈ testable subset           │
│      validate every judgments[*].score ∈ [τ, 1]                                │
│      argmaxByTest() → upsert spec_statements (prune) →                         │
│      upsert spec_test_links (prune) → recordContentHash(linked_by)             │
│      return current SpecCoverageEntry                                          │
└────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                         lore-db (CNPG) — same prod DB the
                         cron + webhook fan-out write to
```

### Compute split — what each side does

| Step | Side | Why |
|---|---|---|
| Reassemble chunks | server | Deterministic, hits DB |
| Segment statements | server | Deterministic; renderer + persistence MUST agree on ordinals |
| Heuristic classification | server | High precision, no LLM, free |
| Candidate pre-filter (`selectCandidates`) | server | Pure; bounds the candidate set to ≤ 25 before the judge sees them |
| Hash + freshness gate | server | DB-backed |
| LLM classifier fallback | **local Claude** | The whole point — uses subscription instead of API |
| LLM statement-level judge | **local Claude** | The whole point |
| `argmaxByTest()` dedup + threshold | server | Trust boundary; client can't bypass τ |
| `persist_*` writes + prune | server | DB-backed; client never holds a DB handle |
| Attribution (`linked_by`) | server | Recorded from the bearer-auth identity at persist time |

## Data Model

One additive column on the existing
[`spec_coverage_runs`](../spec-test-coverage/data-model.md#schemaspec_coverage_runs)
table; no new tables.

```sql
ALTER TABLE {schema}.spec_coverage_runs
  ADD COLUMN IF NOT EXISTS linked_by TEXT;
```

`linked_by` values:

- `cron` — weekly K8s CronJob (`agent/src/job-runner.ts`)
- `webhook` — post-ingest fan-out (`/api/trigger/spec-test-linker`)
- `local:{agent_id}` — a `persist_spec_link` call from a developer's
  Claude session. `agent_id` is the same identifier carried by every
  memory write (`~/.lore/agent-id` or `LORE_AGENT_ID`).

Nullable: pre-existing rows have no attribution; the UI shows "linked
{time-ago}" without a "by" clause until the next run sets it.

## API

### `GET /api/repos/:owner/:repo/spec-coverage/stale` (read scope)

Returns specs the linker should look at — anything whose current
content hash differs from the last recorded hash, or that has never
been linked.

```jsonc
[
  {
    "spec_path": "specs/local-task-runner/spec.md",
    "current_hash": "f3a2…",
    "last_linked_hash": "b91c…",     // null if never linked
    "stale_since": "2026-06-02T13:00:00Z",
    "last_linked_at": "2026-06-01T11:00:00Z",
    "last_linked_by": "cron",
    "statements_count": 24            // current; 0 if never segmented
  }
]
```

### `POST /api/repos/:owner/:repo/spec-coverage/prepare` (read scope)

```jsonc
// request
{ "spec_path": "specs/local-task-runner/spec.md" }

// response
{
  "spec_path": "specs/local-task-runner/spec.md",
  "content": "# Feature Specification: …",
  "content_hash": "f3a2…",
  "statements": [
    {
      "ordinal": 0,
      "text": "A local task runner that runs inside …",
      "kind": "sentence",
      "enclosing_heading": "Feature Specification: Local Task Runner",
      "heuristic": {
        "testability": "untestable",
        "category": "intro",
        "matched_by_section": true
      }
    },
    {
      "ordinal": 14,
      "text": "It claims a pending task before GKE picks it up.",
      "kind": "list-item",
      "enclosing_heading": "Acceptance Criteria",
      "heuristic": {
        "testability": "testable",
        "category": null,
        "matched_by_section": false
      }
    }
  ],
  "candidate_tests": [
    {
      "test_file": "mcp-server/src/local-runner.test.ts",
      "test_name": "local-runner › claims pending task before GKE",
      "test_line": 88,
      "content_snippet": "describe('local-runner', () => { … })",
      "match_kind": "assertion",
      "symbol": "claimNextTask"
    }
  ],
  "candidate_truncated": false,
  "assertion_hints": ["claimNextTask", "LeaseBackend"]   // null if not cached
}
```

The client's job:
- For every statement where `heuristic.matched_by_section === false`,
  decide `testable` vs `untestable` (with `category` when untestable).
- For every candidate test, decide which **single** testable
  statement it most strongly validates (by `ordinal`), with a
  confidence `score` in `[0, 1]` and a one-sentence `rationale`.
- Drop candidates that validate nothing.

### `POST /api/repos/:owner/:repo/spec-coverage/persist` (write scope)

```jsonc
// request
{
  "spec_path": "specs/local-task-runner/spec.md",
  "content_hash": "f3a2…",                  // must match the prep'd hash
  "classifications": [
    { "ordinal": 12, "testability": "testable" },
    { "ordinal": 13, "testability": "untestable", "category": "rationale" }
  ],
  "judgments": [
    {
      "test_file": "mcp-server/src/local-runner.test.ts",
      "test_name": "local-runner › claims pending task before GKE",
      "statement_ordinal": 14,
      "score": 0.86,
      "rationale": "exercises the SKIP LOCKED claim query"
    }
  ],
  "agent_id": "local:abc123"                // optional, attribution
}

// 200 — returns the current SpecCoverageEntry (same shape the UI reads)

// 409 — spec changed during the conversation
{ "error": "content_hash_stale", "current_hash": "9e1d…" }

// 400 — bad input
{ "error": "invalid_ordinal", "ordinal": 99,
  "detail": "Not in the prep'd statement set." }
{ "error": "invalid_score", "score": 1.4,
  "detail": "Must be in [0.5, 1]." }
```

### MCP tool shape

Three new MCP tools registered in
[`mcp-server/src/index.ts`](../../mcp-server/src/index.ts), each
forwarding to the HTTP endpoint via `LORE_API_URL` (mirrors the
existing memory-tool proxy pattern):

```ts
// Zod-validated inputs
prepare_spec_link        { repo, spec_path }
persist_spec_link        { repo, spec_path, content_hash,
                            classifications, judgments, agent_id? }
list_stale_spec_coverage { repo }
```

## File Changes

| File | Change |
|------|--------|
| `terraform/modules/gke-mcp/ui-helm/migrations/0007_spec_coverage_runs_linked_by.sql` | NEW: additive `ALTER TABLE … ADD COLUMN IF NOT EXISTS linked_by TEXT` per-team-schema, mirroring 0006's pattern |
| `agent/src/jobs/cron/spec-test-linker.ts` | Modify: `recordContentHash()` accepts + writes `linked_by`; orchestration passes `'cron'` (default) or whatever the trigger sets |
| `agent/src/health.ts` | Modify: `/api/trigger/spec-test-linker` reads optional `linked_by` from the request body; defaults to `'webhook'` |
| `mcp-server/src/spec-coverage-prepare.ts` | NEW: pure composer; uses shared/agent helpers (`segmentStatements`, `classifyByHeuristic`, `selectCandidates`, etc.); no LLM call |
| `mcp-server/src/spec-coverage-persist.ts` | NEW: pure validation + `argmaxByTest` + threshold; calls into the same persistence helpers the agent uses (extracted to shared if needed) |
| `mcp-server/src/routes.ts` | Modify: register `GET /spec-coverage/stale`, `POST /spec-coverage/prepare`, `POST /spec-coverage/persist`; bearer-auth + scope dispatch via existing middleware |
| `mcp-server/src/index.ts` | Modify: register `prepare_spec_link`, `persist_spec_link`, `list_stale_spec_coverage` MCP tools (stdio + HTTP transports) with Zod schemas |
| `agent/src/jobs/cron/spec-test-linker.test.ts` | Modify: cover the `linked_by` parameter on `recordContentHash` |
| `mcp-server/src/__tests__/spec-coverage-prepare.test.ts` | NEW: prep returns deterministic statements + correct heuristic + candidate cap reporting |
| `mcp-server/src/__tests__/spec-coverage-persist.test.ts` | NEW: stale hash → 409, bad ordinal → 400, score out of range → 400, argmax applied, threshold filter applied, `linked_by` written |
| `mcp-server/src/__tests__/spec-coverage-stale.test.ts` | NEW: returns specs with drifted hash, returns never-linked, returns empty when up-to-date |
| `.claude/skills/lore-link-coverage/skill.md` | NEW: the conversational flow described in §User Experience |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.tsx` | Modify: render the "linked Xh ago by Y" subline when `linked_by != 'cron'` (data already in payload via `coverage-payload`) |
| `mcp-server/src/routes.ts` (`composeSpecCoverage`) | Modify: include `last_linked_at` + `last_linked_by` in the SpecCoverageEntry |
| `CLAUDE.md` | Update the "Agent Memory" / "Task Pipeline" section to mention the BYO-compute coverage flow |

## Acceptance Criteria

1. Migration `0007_spec_coverage_runs_linked_by.sql` applies idempotently across every team schema, adding nullable `linked_by` to `spec_coverage_runs`.
2. `POST /api/repos/:o/:r/spec-coverage/prepare` returns the deterministically segmented statements (matching the segmenter the renderer uses), the section-heuristic classification, the capped candidate test set, and a content hash matching `hashSpecContent(reassembleSpec(chunks))`.
3. `POST /api/repos/:o/:r/spec-coverage/persist` rejects (409) when `content_hash` does not match the current hash; rejects (400) when any classification or judgment references an ordinal absent from the current segmentation; rejects (400) when any score is outside `[τ, 1]`.
4. `persist` applies `argmaxByTest()` and the τ=0.5 threshold server-side; a client request with two judgments for the same `(test_file, test_name)` results in one row (highest score).
5. `persist` writes `spec_statements`, `spec_test_links` (with `statement_ordinal`/`statement_text`/`match_score`), and `spec_coverage_runs` (with `linked_by`), pruning ordinals + links no longer present.
6. `GET /api/repos/:o/:r/spec-coverage/stale` returns the set of specs whose current hash differs from `spec_coverage_runs.content_hash`, plus specs with no `spec_coverage_runs` row, plus specs whose statement-row count is zero.
7. The cron `spec_test_linker` sets `linked_by='cron'`; the post-ingest webhook trigger sets `linked_by='webhook'`; the new `persist` endpoint sets `linked_by='local:{agent_id}'` from the request.
8. The three new MCP tools are registered in `mcp-server/src/index.ts` and proxy to `LORE_API_URL` when running in stdio mode, with bearer auth carrying the developer's API token.
9. `/lore-link-coverage` skill exists at `.claude/skills/lore-link-coverage/skill.md` and drives the end-to-end flow on a real spec, including a 409 retry path.
10. The web UI's per-repo specs page renders correctly regardless of `linked_by` source; the `SpecCard` shows a `linked {time-ago} by {who}` subline only when `linked_by != 'cron'`.
11. A `prepare` followed by `persist` against the same content hash produces a DB state byte-identical to what the cron would produce given the same classifier + judge decisions.
12. Concurrent `prepare`/`persist` round-trips against the same spec converge to a deterministic state: last writer wins (verified by sequencing two `persist` calls and inspecting the final rows).

## Limitations & Open Questions

1. **Assertion extraction stays agent-side for v1.** `extractAssertions` still bills the API key when the cron runs. `prepare` returns cached hints if a recent cron run produced them; otherwise `assertion_hints` is null and the developer's reasoning has to fall back on directory/embedding-pre-filtered candidates. Follow-up: move it to a fourth MCP tool, or to a single combined `prepare_spec_link` that lets the client run the extraction in-conversation.
2. **No claim/lease.** Two developers running `prepare` on the same spec at the same time will both proceed; whoever `persist`s last wins. Rare; add a `claimed_by` / `claimed_until` field if it becomes a real problem.
3. **Batch mode is out of scope.** `persist` takes one spec at a time. A sweep is the skill calling `list_stale` → looping `prepare`/`persist`. Future: a single `persist_spec_link_batch([spec1, spec2, ...])` for terminal-friendly bulk runs.
4. **Subscription billing model.** Claude Code Pro/Max bills per-seat, not per-call. This feature shifts cost from API → seat utilisation. Confirm with finance before recommending org-wide adoption — at high volume a developer's quota could exhaust if they use this aggressively.
5. **UI attribution is best-effort.** Shows `agent_id` verbatim; if the developer hasn't set a name, it'll read `linked 2h ago by local:abc-123`. Could resolve to a real display name via `lore.agents` lookup; out of scope for v1.
6. **Cron and webhook still bill the API key.** This feature gives developers an *option* to use their subscription; it doesn't turn off the existing cron. To do that, ship a `dark_factory.linker = 'manual'` per-repo setting in a follow-up — too entangled with [Dark Factory mode](../6-dark-factory/spec.md) to bundle here.
