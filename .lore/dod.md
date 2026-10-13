# Definition of Done

> Create the SQL view `pipeline.v_auto_merge_kpis` over `pipeline.audit_log` (the `lore_reviewer_approved` and `auto_merge_armed` rows from T006, with columns for the `pr_merged` rows T013 adds, empty until step 2) and add `GET /api/repos/{owner}/{repo}/auto-merge/kpis` (read scope) in `apps/lore-api`.

**Strategy: `direct`** — The API route acts as the system boundary for exposing the new KPI SQL view.

## Done when these pass

- [ ] **returns 200 with auto-merge KPIs from the view** — validates the HTTP endpoint invokes the `v_auto_merge_kpis` view properly and returns its schema
  `apps/lore-api/src/transport/routes/auto-merge-kpis.test.ts`

## Facets

- [x] Create `pipeline.v_auto_merge_kpis` view in Terraform migrations
- [x] Implement `GET /api/repos/{owner}/{repo}/auto-merge/kpis` handler reading from the view
- [x] Register route in API

## Out of scope

- `pr_merged` rows do not need to be populated in this ticket
