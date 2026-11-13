# Feature Specification: Local MCP Self-Update

| Field   | Value                 |
| ------- | --------------------- |
| Feature | Local MCP Self-Update |
| Branch  | feat/mcp-self-update  |
| Status  | Shipped               |
| Created | 2026-08-06            |
| Owner   | Platform Engineering  |

The local `lore-context` MCP adapter runs from an installed checkout and can serve stale code long after Lore has moved on. This feature lets the adapter notice when it is behind the build deployed on lore-api and offer, on the user's consent, to rebuild itself through the audited `lore-update.sh` (which never runs dependency install scripts — the re-cinq/lore#1062 supply-chain vector). Amended 2026-11-13 (#4582): the latest build is lore-api's `latest.build` from [`GET /api/versions`](../api-routes/versions/spec.md), no longer git's `origin/main`, which runs ahead of what is deployed.

## Detection

- When the deployed build is ahead of the adapter's, the check offers an update carrying the number of commits between them. ([validated by offers an update with 3 commits when the deployed build is 3 commits ahead of the adapter @6c8ab24e](apps/mcp-server/src/work/update/mcp-update.test.ts#L7), [validated by names the deployed build and the 1 commit the adapter is behind before the updater's output @37a7385a](apps/mcp-server/src/transport/tools/update/update.test.ts#L60))
- The count is known only when the local checkout holds both commits; without it the update is still offered, with no count. ([validated by offers an update with no count when the checkout lacks the deployed commit @a93f3a6b](apps/mcp-server/src/work/update/mcp-update.test.ts#L16))
- When the adapter was built from the deployed build, the check offers nothing. ([validated by offers nothing when the adapter was built from the deployed short sha @70b01bd6](apps/mcp-server/src/work/update/mcp-update.test.ts#L25), [validated by prints only the updater's output when the adapter is the deployed build @d01c57a2](apps/mcp-server/src/transport/tools/update/update.test.ts#L70))
- When the deployed build is an ancestor of the adapter's (a checkout ahead of the deploy), the check offers nothing. ([validated by offers nothing when the adapter is ahead of the deployed build @a2db0ee4](apps/mcp-server/src/work/update/mcp-update.test.ts#L31))
- When lore-api cannot name the deployed build, or the adapter's build is unknown, the check offers nothing. ([validated by offers nothing when lore-api could not name the deployed build @6efcacd5](apps/mcp-server/src/work/update/mcp-update.test.ts#L37))

## Reaching the user

- The rules that tell the agent to offer `lore_update` live in the MCP server's `instructions`, which Claude Code delivers every session. They used to be written to `~/.claude/settings.json` under `systemPromptSuffix`, a key Claude Code does not read, so the offer never reached anyone. ([validated by carries the session rules, the self-update offer among them, in its instructions @d7880104](apps/mcp-server/src/transport/build-mcp-server.test.ts#L37))
- `lore-merge-settings.js` writes no `systemPromptSuffix` and strips the Lore block an older install left there, dropping the key when nothing else remains. ([validated by mergeLoreSettings writes no systemPromptSuffix and strips the Lore block an older install left @1e18bf76](scripts/lore-merge-settings.test.mjs#L98), [validated by mergeLoreSettings drops a systemPromptSuffix that held only the Lore block @5df4e67f](scripts/lore-merge-settings.test.mjs#L107))
- The SessionStart hook no longer pulls the checkout (a pull without a rebuild hid the gap) and replaces an older install's pulling hook; it runs `lore-version-check.mjs` instead. ([validated by mergeLoreSettings replaces the pulling sync hook with one that checks the deployed version @e659c529](scripts/lore-merge-settings.test.mjs#L85))
- `lore-version-check.mjs` prints `[lore] Your Lore MCP is behind the deployed version (<built> → <latest>). Ask Claude to run lore_update.` when the adapter is behind or its relation to the deployed build is unknown, and nothing otherwise. ([validated by behindLine names the built and latest builds when the adapter is behind @65260161](scripts/lore-version-check.test.mjs#L8), [validated by behindLine treats an unknown relation as behind @d89072c3](scripts/lore-version-check.test.mjs#L15), [validated by behindLine prints nothing for an adapter built from the latest short sha @76a52d0d](scripts/lore-version-check.test.mjs#L19), [validated by behindLine prints nothing for an adapter ahead of the deployed build @5e09972c](scripts/lore-version-check.test.mjs#L23), [validated by behindLine prints nothing without a built or latest build @507047dd](scripts/lore-version-check.test.mjs#L27))

## Background

The adapter's build is the sha in `~/.lore/mcp-build-head` (else the checkout's HEAD); the latest is `latest.build` from `GET /api/versions`, a short sha. Once per session the adapter asks lore-api for the deployed build, and when behind prefixes a `lore_mcp_update_available` banner onto the `lore_assemble_context` result. The instructions have the agent offer the `lore_update` tool, which runs the audited updater only on consent; the updater pulls `origin/main`, so after an update the adapter is at or ahead of the deployed build. Because a process cannot hot-swap its own code, the rebuild applies on the next Claude Code restart.
