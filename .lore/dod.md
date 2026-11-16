# Definition of Done

> Implement three-layer resolution for the execution image in 'agent-defs-pg.ts' and 'agent-defs-port.ts': per-agent override -> repo base image -> org default. Ensure this is evaluated during floor dispatch for both agent and station nodes.

**Strategy: direct** — The 'FloorAgentDefs' class already provides the resolution seam via 'resolve' and 'list'. We just pass the base image as a new parameter and test the result.

## Done when these pass

- [ ] **resolves execution image through three layers: agent override then repo base then org default** — Verifies that 'resolve' uses the base image when no per-agent override exists, falling back to org default.
  libs/shared/src/outbound/project/agents/agent-defs-floor.acceptance.test.ts
- [ ] **applies base image for effective image display in list()** — Verifies that the effective image is properly resolved in 'list' for UI auditing.
  libs/shared/src/outbound/project/agents/agent-defs-floor.acceptance.test.ts

## Facets

- [x] Add baseImage optional parameter to AgentDefsReadPort methods resolve and list.
- [x] Implement the three-layer resolution logic in FloorAgentDefs.resolve using the new parameter.
- [x] Implement the three-layer resolution logic in FloorAgentDefs.list using the new parameter.
- [ ] Update the floor dispatcher (the caller) to retrieve the repository's base_image from settings and pass it to resolve.

## Out of scope

- UI for editing or viewing the base_image setting (FR-BASE-UI).
- Migrating existing agent overrides.
