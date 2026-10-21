# Definition of Done

> Create apps/mcp-server/src/transport/skills-sync.ts that polls the skill-definitions API. It writes directories in ~/.claude/skills/ placing SKILL.md and .lore-managed inside. Wire this loop in the MCP server boot, gated by serverMode !== 'agent'.

**Strategy: `direct`** — The seam already exists in `buildMcpServer`, which is the entry point for the MCP server boot process where the loop will be wired.

## Done when these pass

- [ ] **syncs enabled skills locally with a marker on boot, ignoring unmanaged directories.** — The MCP server polls the skill-definitions API on boot and writes enabled skills as `.lore-managed` directories in `~/.claude/skills/`, deleting disabled ones and leaving unmanaged ones alone.
  `apps/mcp-server/src/transport/skills-sync.acceptance.test.ts`

## Facets

- [ ] Create `skills-sync.ts` with API fetching and file writing logic.
- [ ] Hook `skills-sync.ts` into `build-mcp-server.ts` gated by `serverMode !== 'agent'`.

## Out of scope

- Multi-file skills or per-repo skill overrides.
- Changes to the HTTP gateway serving agent pods.