// The packages whose `src/` tests feed the graph, shared by `list` and `related`;
// a listed package the checkout does not hold is left out. Override to narrow
// scope, e.g. LORE_TRACE_PKGS=libs/shared LORE_TRACE_SCOPE=src/spec-trace.
import { existsSync } from "node:fs";

export const PKGS = (
  process.env.LORE_TRACE_PKGS ||
  "libs/shared,libs/runner,libs/server-core,apps/lore-api,apps/mcp-server,apps/web-ui"
)
  .split(",")
  .map((s) => s.trim())
  .filter((pkg) => pkg && existsSync(pkg));
export const SCOPE = process.env.LORE_TRACE_SCOPE || "src"; // all src tests per package
