# Definition of Done

> Baseline setup scripts create team-schema chunks tables as postgres, so
> lore-owned migrations cannot alter them

**Strategy: `direct`** — the seam already exists. `.github/workflows/migrations.yml`
builds the COMPLETE baseline through the real entry point (`scripts/infra/setup-local-schema.sh`,
which runs the same `setup-*.sh` DDL the cluster runs) against a real pgvector
container, then acts on it as roles `postgres` and `lore`. Its `Fixture — …`
steps are this repo's acceptance tests for live-database semantics that no unit
suite can reach — the workflow says so itself (the 0042 step: *"Proven here
because the unit suites assert the SQL text only, never live … semantics"*).
Object ownership (`must be owner of …`) is exactly that class: it is a property
of the live catalog, not of any source text, so a source-scan test would pin
prose, not behaviour. The new fixture drives the real baseline and then, **as
role `lore`**, performs the exact DDL migration `0070_chunks_search_tsv_strip_links`
performed in #1933 — `DROP INDEX <schema>.<schema>_chunks_search_idx` and
`ALTER TABLE <schema>.chunks` — on every team schema.

## Done when these pass

- [ ] **Fixture — lore owns every team-schema chunks table** — as role `lore`,
  `DROP INDEX`/`CREATE INDEX` on each `<team>.chunks` search index and
  `ALTER TABLE <team>.chunks` succeed for all five team schemas
  (`payments`, `platform`, `mobile`, `data`, `org_shared`). Fails today with
  `must be owner of index payments_chunks_search_idx` — the #1933 error — because
  the baseline creates these objects as `postgres` and only ever GRANTs `lore`
  DML + `CREATE/USAGE`, never ownership.
  `.github/workflows/migrations.yml`

## Facts / running note

- This is a live-multi-role-Postgres behaviour. The DoD pod has **no** Postgres
  and **no** docker, and no pure-JS Postgres (pg-mem/PGlite) models GRANT/
  ownership, so the red bar cannot be produced in the pod — CI's `DB Migrations`
  workflow (which `.github/workflows/migrations.yml` is, and which its own
  `paths:` filter re-triggers on this edit) is the judge, exactly as it is for
  the 0035 and 0042 fixtures beside this one.

## Facets

- [x] Baseline (`scripts/infra/setup-db.sh` for the cluster, and the mirrored
  block + ownership-reconcile loop in `scripts/infra/setup-local-schema.sh`)
  hands each `<team>.chunks` table — and thus its indexes — to `lore`, e.g. by
  extending the ownership-reconcile loop to the team schemas or an explicit
  `ALTER TABLE <schema>.chunks OWNER TO lore` after creation.

## Out of scope

- The one-time `REASSIGN OWNED` sweep for OTHER `postgres`-owned objects in team
  schemas (the ticket's second "what remains" bullet). Only `chunks` is the
  reported failure; a broader sweep is a separate change.
- A `NNNN` migration-filename uniqueness check (the ticket's third bullet). It is
  a real, presently-live collision (three `0070_*` and two `0071_*` files exist)
  but it is a distinct guard, not the ownership claim — see the finding in the
  handoff message.
