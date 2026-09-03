// Editor href per agent node: `project_id` on the resolved definition picks repo Agents tab vs global /agents; no catalog entry means no link.
import type { AssemblyLineDefinition } from "./assembly-line-definition";

export interface AgentDefRef {
  name: string;
  project_id?: string | null;
}

/** nodeId → editor href, for every agent node whose recipe the catalog holds. */
export function agentEditHrefs(
  definition: AssemblyLineDefinition | null,
  defs: readonly AgentDefRef[],
  repo: string,
): Record<string, string> {
  if (!definition) {
    return {};
  }
  const hrefs: Record<string, string> = {};

  for (const node of definition.nodes) {
    if (node.type !== "agent") {
      continue;
    }
    const recipe = node.prompt_ref ?? node.id;
    const def = defs.find((d) => d.name === recipe);

    if (!def) {
      continue;
    }
    hrefs[node.id] = def.project_id
      ? `/repos/${repo}/agents/${encodeURIComponent(recipe)}/edit`
      : `/agents/edit/${encodeURIComponent(recipe)}`;
  }

  return hrefs;
}
