// Where "edit this agent" goes for each agent node of a run's graph.
//
// The run page's node inspector shows WHAT a recipe did; changing the recipe
// happens in the agents editor — and there are two, because definitions
// resolve project → org (CLAUDE.md "Agent definitions"): a repo override is
// edited on the repo's Agents tab, an org default in the global /agents
// editor. The discriminator is the resolved definition's `project_id`, the
// same field the repo Agents list badges overrides with. A recipe the catalog
// does not hold gets no link — pointing an editor at a definition that would
// be CREATED by saving is the /agents/new flow, not this affordance.

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
