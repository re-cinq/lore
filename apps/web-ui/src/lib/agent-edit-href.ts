// Editor href per agent node: `project_id` on the resolved definition picks repo Agents tab vs global /agents; no catalog entry means no link.
import type {
  AssemblyLineDefinition,
  DefinitionNode,
} from "./assembly-line-definition";
import { recipeNameFor } from "./recipe-ref";

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
    const entry = hrefForAgentNode(node, defs, repo);

    if (entry) {
      hrefs[entry[0]] = entry[1];
    }
  }

  return hrefs;
}

function hrefForAgentNode(
  node: DefinitionNode,
  defs: readonly AgentDefRef[],
  repo: string,
): [string, string] | null {
  const recipe = recipeNameFor(node);
  const def = defs.find((d) => d.name === recipe);

  if (recipe === null || !def) {
    return null;
  }

  const href = def.project_id
    ? `/repos/${repo}/agents/${encodeURIComponent(recipe)}/edit`
    : `/agents/edit/${encodeURIComponent(recipe)}`;

  return [node.id, href];
}
