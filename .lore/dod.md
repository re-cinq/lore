# Definition of Done

> At lore-api boot, existing static skills must be migrated to the database following the seedAgentDefaults pattern, adding a required Help block to each.

**Strategy: `direct`** — The seeding function is invoked on boot; we can write a direct acceptance test that verifies the database state. Since this environment cannot install npm dependencies to run the test locally, the red bar is CI's to show ("Integration Tests" job).

## Done when these pass

- [ ] **seeds the three static skills with a Help block into lore.skill_definitions** — Evaluates whether the seeding logic correctly inserts `lore-context`, `tdd-loop`, and `legacy-characterize` into `lore.skill_definitions` with the required `<!-- lore-help:begin -->` and `<!-- lore-help:end -->` blocks.
  `apps/lore-api/src/integration-tests/skill-defaults-seed.acceptance.test.ts`

## Facets

- [ ] Create `libs/shared/src/agent-defaults/skill-defaults-seed.ts` (or `libs/shared/src/outbound/project/skills/skill-defaults-seed.ts`).
- [ ] Implement `seedSkillDefaults` to read `apps/mcp-server/agent-skills/skills/` and upsert into `lore.skill_definitions`.
- [ ] Add Help block generation during the seed process for existing static skills.
- [ ] Invoke `seedSkillDefaults` in `apps/lore-api/src/index.ts` during server boot.

## Out of scope

- Creating the `lore.skill_definitions` table and its migrations (done in #2863).
- Exposing the HTTP endpoints for skill definitions.
- Local MCP server sync mechanism.
