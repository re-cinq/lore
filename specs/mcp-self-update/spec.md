# Feature Specification: Local MCP Self-Update

| Field   | Value                 |
| ------- | --------------------- |
| Feature | Local MCP Self-Update |
| Branch  | feat/mcp-self-update  |
| Status  | Shipped               |
| Created | 2026-08-06            |
| Owner   | Platform Engineering  |

The local `lore-context` MCP adapter runs from an installed checkout that the SessionStart hook pulls but never rebuilds, so it silently serves stale code after upstream changes. This feature lets the adapter notice when it is behind `origin/main` and offer, on the user's consent, to rebuild itself through the audited `lore-update.sh` (which never runs dependency install scripts — the re-cinq/lore#1062 supply-chain vector).

## Detection

- When `origin/main` is ahead of the built SHA, the check reports an available update carrying the number of commits behind. ([validated by `mcp-update.test.ts:5`](apps/mcp-server/src/features/update/mcp-update.test.ts#L5))
- When the built and remote SHAs are identical, the check reports no available update. ([validated by `mcp-update.test.ts:14`](apps/mcp-server/src/features/update/mcp-update.test.ts#L14))
- When the built and remote SHAs differ but no commits separate them, the check reports no available update. ([validated by `mcp-update.test.ts:23`](apps/mcp-server/src/features/update/mcp-update.test.ts#L23))
- When the built SHA is absent, the check reports no available update. ([validated by `mcp-update.test.ts:32`](apps/mcp-server/src/features/update/mcp-update.test.ts#L32))

## Background

Once per session the adapter fetches `origin/main`, and when behind prefixes a `lore_mcp_update_available` banner onto the `lore_assemble_context` result. A system-prompt rule has the agent offer the `lore_update` tool, which runs the audited updater only on consent; because a process cannot hot-swap its own code, the rebuild applies on the next Claude Code restart.
