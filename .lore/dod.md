# Definition of Done

> `hybridSearch` (`libs/server-core/src/outbound/db.ts`) and `hybridChunkItems` (`libs/shared/src/outbound/project/knowledge/context-assembly-chunk-search.ts`) are two implementations of the same idea. The relevance batch #1922–#1937 improved only the second. `lore_search_context` — newly routed through the first by #1971 — therefore still exhibits the defects that batch was written to remove.

**Strategy: `direct`** — `hybridSearch` is a callable function that accepts a fake pool; the SQL it sends to that pool and the scores it returns are both directly observable without a live database.

## Done when these pass

- [ ] **keyword leg uses websearch_to_tsquery with extracted key terms, not plainto_tsquery over the whole question** — the hybrid SQL emitted to the pool contains `websearch_to_tsquery` and does not contain `plainto_tsquery`
  `libs/server-core/src/outbound/db-hybrid-defects.test.ts`

- [ ] **normalises rrf_score so the highest-ranked result is 1.0 (not a raw 1/61 value)** — when the pool returns rows with raw RRF scores (~1/61), the returned `rrf_score` for the top result is 1.0
  `libs/server-core/src/outbound/db-hybrid-defects.test.ts`

## Facets

- [ ] Replace `plainto_tsquery($2)` in `buildHybridSearchSQL` with `websearch_to_tsquery('english', $2)` and pass extracted key terms as `$2` instead of the raw query string
- [ ] Apply `normalizeScores` to the rows returned by `hybridSearch` before returning (mirrors what `toItems` does in `context-assembly-chunk-search.ts`)
- [ ] (Optional convergence) Decide whether `hybridSearch`'s callers can move onto `hybridChunkItems`, or extract a shared core; document the reason if two wrappers remain

## Out of scope

- Repo binding (defect 3 from the ticket): `hybridSearch` has no `repo` parameter; adding one changes the public interface and all callers — a larger step than the two behavioral fixes this ticket asks for
- Moving callers of `hybridSearch` onto `hybridChunkItems` (full convergence) — the ticket marks this as optional
- Any change to `hybridChunkItems` or its tests
