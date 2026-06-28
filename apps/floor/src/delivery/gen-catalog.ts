// CLI: regenerate the ai-agents-helm seeded catalog from scripts/task-types.yaml.
//   node apps/floor/dist/delivery/gen-catalog.js   (or: npm run gen:catalog)
// Thin IO shell around the pure catalog generator (agent-catalog.ts); excluded from
// coverage. A drift check re-runs it and diffs the committed output.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { catalogChartYaml, type TaskTypeConfig } from "../agent/agent-catalog.js";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const src = resolve(repoRoot, "scripts/task-types.yaml");
const dest = resolve(
  repoRoot,
  "infra/terraform/modules/gke-mcp/ai-agents-helm/templates/catalog.yaml",
);

const parsed = parse(readFileSync(src, "utf8")) as {
  task_types: Record<string, TaskTypeConfig>;
};
writeFileSync(dest, catalogChartYaml(parsed.task_types));
console.log(`[gen-catalog] wrote ${dest}`);
