# Definition of Done

> A satellite installed with `scripts/install-satellite.sh` seeds the full recipe catalog but gives its agent pods **no Lore MCP server**, so those pods have no way to reach Lore context at all.

**Strategy: `direct`** — `install-satellite.sh`'s flag-parsing loop is the seam. The loop runs before any `helm`/`kubectl` check, so running the script with `--mcp-url` currently dies immediately with "unknown flag: --mcp-url". The test observes that behaviour through the real script binary.

## Done when these pass

- [ ] **`--mcp-url` is a recognised flag, not an unknown one (#1629)** — the script accepts `--mcp-url <url>` and stores it in `LORE_MCP_URL`; a call that includes only that flag fails later on a missing required value or missing tool, never on "unknown flag".
  `scripts/install-satellite.test.mjs`

## Facets

- [ ] Add `--mcp-url) LORE_MCP_URL="$2" && shift 2 ;;` to the `case` statement in `install-satellite.sh`.
- [ ] Build `mcp_args` from `LORE_MCP_URL` and pass `--set-string "ai-agents.loreMcpUrl=$LORE_MCP_URL"` in the `helm upgrade --install` call, following the same guard pattern as `skills_args`.
- [ ] Add a usage comment for `LORE_MCP_URL` / `--mcp-url` to the header block in `install-satellite.sh` alongside the `LORE_SKILLS_URL` entry.
- [ ] Add an "MCP opted in" section to `check-cluster-agent-standalone-render.sh` that renders with `ai-agents.loreMcpUrl` set and asserts `mcp_servers` (and `lore-mcp-auth`) appear — the regression guard that criterion 3 asks for.

## Out of scope

- Updating `buildInstallInfo`/`renderInstallScript` to bake `LORE_MCP_URL` into the API-generated installer script (a separate improvement; operators can pass `--mcp-url` by hand).
- End-to-end verification that an agent pod on a satellite can complete `lore_assemble_context` (requires a real satellite cluster and a live Lore API).
- Updating the `| Status |` row in any spec (the feature is not implemented here).
