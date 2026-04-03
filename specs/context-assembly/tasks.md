# Tasks: Context Assembly Templates

| Field   | Value    |
|---------|----------|
| Status  | Complete |
| Created | 2026-04-03 |

- [x] T001 Create `mcp-server/templates/` directory
- [x] T002 Create `default.yaml` template — all sources, balanced priorities
- [x] T003 Create `review.yaml` template — conventions/ADRs highest priority
- [x] T004 Create `implementation.yaml` template — repo context and ADRs first
- [x] T005 Create `research.yaml` template — facts and graph prioritized
- [x] T006 Implement `loadTemplates()` — YAML template loading with startup caching
- [x] T007 Implement parallel source retrieval via `Promise.all`
- [x] T008 Implement token budget allocation proportional to priority
- [x] T009 Implement paragraph-boundary truncation
- [x] T010 Implement output formatting with markdown section headers
- [x] T011 Register `assemble_context` MCP tool in `index.ts`
- [x] T012 Add `COPY templates ./templates` to Dockerfile
- [x] T013 Unit tests for token estimation, truncation, template loading, assembly
