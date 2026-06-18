# Implementation Plan: Smart Feature Planning

Spec-first, TDD. Acceptance criteria in `spec.md` are the test checklist; as each
test goes green, append its inline `([validated by …](path/to/test.ts#Lnn))` link
to the satisfied criterion and re-verify the other links on that statement.

## Build order

0. **Spec + ADR** — `specs/7-feature-planning/spec.md`, `data-model.md`, this file, and `adrs/ADR-027-feature-planning-stations.md`.
1. **Migration `0017_feature_planning.sql`** (`lore` schema) — pre-flight via `setup-local-schema.sh` (apply + idempotent re-run + isolated twice-apply) and a CI guard, *before* any code depends on the tables.
2. **`libs/shared` contract** — `feature-planning/gap-result.ts` (`gapResultSchema`, `parseGapResult`, `sanitizeSvg`, `decideFeatureStatus`) — TDD.
3. **`libs/shared` Project port** — `project/features/{features-port,features-pg,features}.ts` wired into `project-factory.ts` + `project.ts` + `project/index.ts` — TDD.
4. **mcp-server** — `api/routes/features.ts` (list, create+kick, get, iterations, iterations/:n/result, finalize, split) + `auth.ts` scope overrides + `TRUST_LEVELS` entries.
5. **Station path** — `feature-planning.yaml` / `feature-finalize.yaml` workflows; `job-builder` task-type→workflow map (decoupled from dark-factory) + `LORE_FEATURE_ID` env; context hydration timeline injection; pod result POST; `loretask-watcher` planning no-changes / finalize handling.
6. **Graph** — merge persistent features in the `trace/graph` route; `SpecGraphNode.status`/`featureId`; `SpecGraphD3` status coloring.
7. **web-ui** — Features tab; list/detail; smart wizard; schema-driven gap renderer; sandboxed mockup + Mermaid; per-section feedback; split; finalize.

## Key reuse

- `handle-feature-request.ts` (PR machinery template), `loretask-watcher.ts` (PR + conditional Issue), `dark-factory.ts` `decideIssueCreate`.
- Project ports pattern (`tasks/task-store-pg.ts`, `audit/audit-pg.ts`), `prFooter` trailer.
- web-ui polling (`app/pipeline/[id]/Timeline.tsx`), privileged-write client (`lib/mcp-settings.ts`), safe `components/Markdown.tsx`, `queryAllowMissing`.
- Graph: `spec-trace/spec-graph.ts` `flattenSpecGraph`, `feature-dir.ts`, `trace/trace-dgraph.ts`.

See `~/.claude/plans/we-need-a-new-sparkling-mist.md` for the full design rationale.
