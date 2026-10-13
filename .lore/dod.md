# Definition of Done

> Write the next numbered migration under `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations`: table `(repo, pr_number, reason, detail, since, updated_at)`, one row per open PR Lore watches, and the 30-day purge of rows whose PR merged or closed.

**Strategy: `direct`** — The integration suite provides a test Postgres database to run queries against. The test fails because the migration is not yet written, so the table does not exist. The pod cannot run the tests (no Postgres), so CI's `integration` job on pull request proves the red bar.

## Done when these pass

- [ ] **has the required columns** — verifies the `pr_blocked_reasons` table exists with the required schema
  `apps/lore-api/src/integration-tests/pr-blocked-reasons.test.ts`

## Facets

- [ ] Add the migration SQL under `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations`

## Out of scope

- Implementing the routes or the blocked-reason station
