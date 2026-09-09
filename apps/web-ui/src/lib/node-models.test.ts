import { describe, it, expect } from "vitest";
import type { AssemblyLineDefinition } from "./assembly-line-definition";
import { modelShortLabel, resolveNodeModels } from "./node-models";
import { recipeNameFor } from "./recipe-ref";

const definition: AssemblyLineDefinition = {
  name: "implementation",
  description: "",
  version: 1,
  entry: "implement",
  exit: "validate",
  nodes: [
    { id: "implement", type: "agent", model: "claude-opus-4-8" },
    { id: "review", type: "agent", prompt_ref: "code-review" },
    { id: "validate", type: "validate" },
  ],
  edges: [],
};

describe("recipeNameFor", () => {
  it("names an agent node's recipe by prompt_ref, falling back to the node id, and nothing for a station", () => {
    expect(recipeNameFor(definition.nodes[0])).toBe("implement");
    expect(recipeNameFor(definition.nodes[1])).toBe("code-review");
    expect(recipeNameFor(definition.nodes[2])).toBeNull();
  });
});

describe("resolveNodeModels", () => {
  it("takes the catalog's model over the definition's and marks its source", () => {
    const models = resolveNodeModels(definition, [
      { name: "implement", model: "claude-sonnet-4-6" },
      { name: "code-review", model: "claude-haiku-4-5-20251001" },
    ]);

    expect(models).toEqual({
      implement: { model: "claude-sonnet-4-6", source: "recipe" },
      review: { model: "claude-haiku-4-5-20251001", source: "recipe" },
    });
  });

  it("falls back to the definition's model when the catalog has no answer, and skips nodes with neither", () => {
    expect(
      resolveNodeModels(definition, [{ name: "implement", model: null }]),
    ).toEqual({
      implement: { model: "claude-opus-4-8", source: "definition" },
    });
  });

  it("resolves nothing for a run without a definition", () => {
    expect(resolveNodeModels(null, [])).toEqual({});
  });
});

describe("modelShortLabel", () => {
  it("labels a curated model id and echoes an unknown one", () => {
    expect(modelShortLabel("claude-sonnet-4-6")).toBe("Sonnet 4.6");
    expect(modelShortLabel("claude-next-9")).toBe("claude-next-9");
  });
});
