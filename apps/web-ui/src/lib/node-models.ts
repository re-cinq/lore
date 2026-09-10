// Which model each agent node runs on (run-viz FR4.16): the resolved catalog (per-repo row → org row → yaml) wins, the definition's own `model` is the fallback, and a node that runs no recipe has none.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import { KNOWN_MODELS } from "./agents-mirror";
import { recipeNameFor } from "./recipe-ref";

export interface NodeModel {
  model: string;
  /** Where the answer came from: the live catalog, or the definition graph. */
  source: "recipe" | "definition";
}

export interface CatalogModel {
  name: string;
  model: string | null;
}

/** nodeId → model, for every agent node with an answer. */
export function resolveNodeModels(
  definition: AssemblyLineDefinition | null,
  catalog: readonly CatalogModel[],
): Record<string, NodeModel> {
  const models: Record<string, NodeModel> = {};

  for (const node of definition?.nodes ?? []) {
    const recipe = recipeNameFor(node);
    const resolved =
      recipe === null ? null : modelFor(recipe, node.model, catalog);

    if (resolved) {
      models[node.id] = resolved;
    }
  }

  return models;
}

function modelFor(
  recipe: string | null,
  definitionModel: string | undefined,
  catalog: readonly CatalogModel[],
): NodeModel | null {
  const fromCatalog = catalog.find((entry) => entry.name === recipe)?.model;

  if (fromCatalog) {
    return { model: fromCatalog, source: "recipe" };
  }

  return definitionModel
    ? { model: definitionModel, source: "definition" }
    : null;
}

/** The curated label for a model id, else the id itself — a new model reads as its id rather than as nothing. */
export function modelShortLabel(model: string): string {
  return KNOWN_MODELS.find((known) => known.id === model)?.label ?? model;
}
