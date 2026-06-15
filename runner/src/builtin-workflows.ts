import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkflowDir, type Workflow } from "./loader.js";

/**
 * The workflow YAMLs that ship inside this package (gap-fill, general,
 * implementation), copied to `dist/workflows/` by the build. Resolved relative
 * to the compiled module so the kernel finds them regardless of cwd — both the
 * in-agent path and the pod entry use this instead of hand-rolling a path.
 */
const WORKFLOWS_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "workflows",
);

export function loadBuiltinWorkflows(): Promise<Map<string, Workflow>> {
  return loadWorkflowDir(WORKFLOWS_DIR);
}
