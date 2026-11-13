# Feature Specification: `lore_versions` MCP tool

| Field   | Value                    |
|---------|--------------------------|
| Feature | `lore_versions` MCP tool |
| Status  | In Progress              |
| Created | 2026-11-13               |
| Owner   | Platform Engineering     |
| Tool    | `lore_versions`          |
| Module  | versions                 |
| Scope   | shared                   |

`lore_versions` prints which build of every Lore part runs, read from [`GET /api/versions`](../../api-routes/versions/spec.md), as a short list; on a laptop it also says whether this adapter is the deployed build. Issue #4581.

## Interface

Registered via `server.tool` in `apps/mcp-server/src/transport/tools/versions/versions.ts`, among the shared tools, so agent pods reach it on the gateway too. ([validated by registers lore_versions @77f216d0](apps/mcp-server/src/transport/tools/versions/index.test.ts#L6), [validated by serves lore_versions on the gateway too @1ee1e778](apps/mcp-server/src/transport/build-mcp-server.test.ts#L45))

The tool is named `lore_versions` and takes no input. ([validated by registers lore_versions @77f216d0](apps/mcp-server/src/transport/tools/versions/index.test.ts#L6))

## Behavior

The tool proxies `GET /api/versions` and prints the answer, one part per line, headed by the latest build. ([validated by proxies GET /api/versions and prints the list @28e9eee8](apps/mcp-server/src/transport/tools/versions/versions.test.ts#L132))

Each service line names its build, its start and its bundled packages, the floor line its build and schema, then one line per live cluster with the floor agent's build and the AI subsystem's version and CLI pins; then the database migrations, the pipelines and agent definitions on the floor (naming any shipped pipeline the floor lacks) and the agent image, while a part that failed prints `error: <its error>`. ([validated by prints each part on its own line, an error where a part failed @9a7d01d4](apps/mcp-server/src/transport/tools/versions/versions.test.ts#L65), [validated by prints a cluster with no subsystem and errors for the floor's other parts @e628d94c](apps/mcp-server/src/transport/tools/versions/versions.test.ts#L104))

On a laptop, where `~/.lore/mcp-build-head` holds the adapter's build, a last line says whether this adapter is the latest build or is behind it and should run `lore_update`. The line uses the same check as the update offer: it compares the adapter's full build with the deployed short one by prefix, and an adapter ahead of the deployed build, as right after `lore_update`, reads as the latest. ([validated by adds this adapter's build and that it matches the latest @c433b7f1](apps/mcp-server/src/transport/tools/versions/versions.test.ts#L82), [validated by tells an adapter behind the latest to run lore_update @310bf594](apps/mcp-server/src/transport/tools/versions/versions.test.ts#L93))

An unconfigured API, a denied token and an unreachable API answer the shared refusal texts. ([validated by reports a missing API configuration @fe59fc7c](apps/mcp-server/src/transport/tools/versions/versions.test.ts#L146))

## Out of Scope

- Updating the adapter: [`lore_update`](../../mcp-self-update/spec.md).
