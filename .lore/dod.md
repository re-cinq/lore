# Definition of Done

> re-cinq/lore's override rows for `code-review`, `code-review-recheck` and `code-review-refine` (created from the repo agents page when the model was set to Pro) carry a full copy of the prompt as it was that day, plus the config block. `resolveAgentConfig` (`libs/shared/src/outbound/project/agents/agent-defs-port.ts`) merges per field, project over org, so the copied prompt wins for ever

**Strategy: `direct`** — The seam exists in `AgentForm` to prevent writing identical overrides, and in `seedAgentDefaults` to nullify them on boot.

## Done when these pass

- [ ] **AgentForm (Acceptance)** — Renders 'inherited from org' for an inherited field and sends it as null when submitting untouched.
  `apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.acceptance.test.tsx`
- [ ] **seedAgentDefaults (Acceptance)** — The boot job's database cleanup logic drops previously saved duplicate fields from project overrides.
  `apps/lore-api/src/integration-tests/agent-defaults-seed.acceptance.test.ts`

## Facets

- [ ] Change `AgentDefinitionRead` or `listAgents` API to expose inherited fields on the project definition.
- [ ] Make `AgentForm` use inherited field metadata to render the "inherited" notice.
- [ ] Update `agentFormValues` to emit `""` (which `parseAgentForm` maps to `null`) for inherited fields to prevent rewriting them.
- [ ] Update `seedAgentDefaults` to nullify project row fields that are identical to their org row counterparts on startup.

## Out of scope

- Standalone migration scripts outside the startup sequence.
