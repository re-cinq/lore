// CLI: regenerate the ai-agents-helm seeded catalog from scripts/task-types.yaml.
//   node apps/floor/dist/delivery/gen-catalog.js   (or: npm run gen:catalog)
// Thin IO shell around the pure catalog generator (agent-catalog.ts); excluded from
// coverage. A drift check re-runs it and diffs the committed output.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  catalogChartYaml,
  type AgentCatalogConfig,
  type StationCatalogConfig,
} from "../jobs/agent/agent-catalog.js";

function generateCatalog(): void {
  const repoRoot = resolve(import.meta.dirname, "../../../..");
  const src = resolve(repoRoot, "scripts/task-types.yaml");
  const dest = resolve(
    repoRoot,
    "infra/terraform/modules/gke-mcp/lore-platform/charts/ai-agents-helm/templates/catalog.yaml",
  );

  const parsed = parse(readFileSync(src, "utf8")) as {
    task_types: Record<string, AgentCatalogConfig>;
    stations?: Record<string, StationCatalogConfig>;
  };

  writeFileSync(
    dest,
    catalogChartYaml(parsed.task_types, parsed.stations ?? {}),
  );
  console.log(`[gen-catalog] wrote ${dest}`);
}

// Only run the filesystem write when invoked as the CLI, not on import (a bare
// `import` of this module used to read + write files as a side effect).
const argv1 = process.argv[1] ?? "";

if (argv1.endsWith("gen-catalog.js") || argv1.endsWith("gen-catalog.ts")) {
  generateCatalog();
}
