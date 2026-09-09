// Context assembly is single-sourced in @re-cinq/lore-shared (project/knowledge/context-assembly); re-exported here for back-compat with this module's existing importers (index, routes/context).
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

// Loads the YAML templates shipped with server-core (libs/server-core/templates); both the local adapter and remote API call this at boot rather than computing an app-relative path (resolves identically from src/ and dist/).
export function loadDefaultTemplates(): void {
  loadTemplates(join(import.meta.dirname, "..", "..", "..", "templates"));
}
