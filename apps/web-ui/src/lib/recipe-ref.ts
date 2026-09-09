import type { DefinitionNode } from "./assembly-line-definition";

/** The agent recipe a node runs: its `prompt_ref`, else its own id. Only agent nodes have one — a validate, gate or human station is not a recipe. */
export function recipeNameFor(node: DefinitionNode): string | null {
  if (node.type !== "agent") {
    return null;
  }

  return node.prompt_ref ?? node.id;
}
