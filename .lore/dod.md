  # Definition of Done

  > Update scripts/infra/setup-dark-factory-schema.sh

  **Strategy: `mechanical`** — The ticket is a fully-specified edit that owes no new permanent test. The SQL indexes requested in the ticket implement FR6.42, whose query behaviour is already pinned and tested by `assembly-runs.test.ts`.

  ## Done when these pass

  - [ ] **list returns only the runs of the named blueprint, newest first** — the query layer respects the parameters that these indexes cover
    `libs/shared/src/outbound/project/assembly-runs/assembly-runs.test.ts`

  ## Facets

  - [x] Update scripts/infra/setup-dark-factory-schema.sh to include `assembly_runs` indexes.

  ## Out of scope

  - Changes to the production migrations in `ui-helm` which already received these indexes in `0040_assembly_runs.sql`.
