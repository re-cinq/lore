// Context assembly is single-sourced in @re-cinq/lore-shared
// (project/knowledge/context-assembly) so the Project facade owns the canonical
// retrieval engine; re-exported here for back-compat with this module's existing
// importers (index, routes/context). The YAML templates ship with server-core
// (libs/server-core/templates); loadDefaultTemplates() loads them at boot.
import { join } from "node:path";
import { loadTemplates } from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";

export {
  assembleContext,
  loadTemplates,
  type FetchStatus,
  type FetchResult,
  type TraceSection,
  type AssemblyTrace,
  type AssembledResult,
} from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";

// Load the YAML context-assembly templates that ship with server-core
// (libs/server-core/templates). Both the local adapter and the remote API call
// this at boot instead of computing an app-relative path. Resolves identically
// from src/ and dist/ (three levels up from features/context lands at the
// package root).
export function loadDefaultTemplates(): void {
  loadTemplates(join(import.meta.dirname, "..", "..", "..", "templates"));
}
