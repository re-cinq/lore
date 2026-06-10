// Context assembly is single-sourced in @re-cinq/lore-shared
// (project/knowledge/context-assembly) so the Project facade owns the canonical
// retrieval engine; re-exported here for back-compat with this module's existing
// importers (index, routes/context). Templates still live in mcp-server/templates
// and are loaded at boot via loadTemplates(<explicit mcp dir>).
export {
  assembleContext,
  loadTemplates,
  type FetchStatus,
  type FetchResult,
  type TraceSection,
  type AssemblyTrace,
  type AssembledResult,
} from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";
