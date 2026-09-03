// CLI: regenerate the ai-agents-helm seeded catalog from scripts/task-types.yaml (npm run gen:catalog); thin IO shell around agent-catalog.ts, excluded from coverage — a drift check re-runs it and diffs the committed output.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    "infra/terraform/modules/gke-mcp/lore-platform/charts/ai-agents-helm/files/catalog-seed.yaml",
  );

  const parsed = parse(readFileSync(src, "utf8")) as {
    task_types: Record<string, AgentCatalogConfig>;
    stations?: Record<string, StationCatalogConfig>;
  };

  // The generated file lives beside the chart's templates, not among them — a fresh checkout has no files/ dir until this runs.
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    catalogChartYaml(parsed.task_types, parsed.stations ?? {}),
  );
  console.log(`[gen-catalog] wrote ${dest}`);
}

// Only run the filesystem write when invoked as the CLI, not on import (a bare `import` used to read + write files as a side effect).
const argv1 = process.argv[1] ?? "";

if (argv1.endsWith("gen-catalog.js") || argv1.endsWith("gen-catalog.ts")) {
  generateCatalog();
}
