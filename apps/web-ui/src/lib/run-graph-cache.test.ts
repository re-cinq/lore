import { describe, it, expect } from "vitest";
import { graphIsCacheable, mergeRunGraph } from "./run-graph-cache";
import { featurePlanningDefinition } from "./definition-fixtures";
import type { FeatureRunPayload } from "./feature-run";

describe("graph caching across poll ticks", () => {
  const withGraph = (
    over: Partial<FeatureRunPayload> = {},
  ): FeatureRunPayload => ({
    id: "run-1",
    status: "running",
    startedAt: null,
    repo: "re-cinq/lore",
    reason: null,
    definition: featurePlanningDefinition,
    synthetic: false,
    nodes: [],
    tokens: null,
    ...over,
  });

  it("a real run's graph is cacheable — it is a clone, stamped once, never edited", () => {
    expect(graphIsCacheable(withGraph())).toBe(true);
  });

  it("a SYNTHETIC graph is never cacheable — it is inferred from visit rows and grows as they land", () => {
    expect(graphIsCacheable(withGraph({ synthetic: true }))).toBe(false);
  });

  it("a run with no graph at all is not cacheable", () => {
    expect(graphIsCacheable(withGraph({ definition: null }))).toBe(false);
  });

  it("keeps the graph the client already holds when the server omits it", () => {
    const next = withGraph({ definition: null, definitionUnchanged: true });

    expect(mergeRunGraph(withGraph(), next).definition).toEqual(
      featurePlanningDefinition,
    );
  });

  it("takes the server's graph whenever one is sent, even if the client had another", () => {
    // A retry mints a NEW run with its own clone. The client must not keep showing
    // the previous run's graph, which is why the request names the run it holds.
    const other = { ...featurePlanningDefinition, entry: "elsewhere" };
    const next = withGraph({ id: "run-2", definition: other });

    expect(mergeRunGraph(withGraph(), next).definition).toEqual(other);
  });

  it("does not resurrect a graph for a DIFFERENT run than the one cached", () => {
    // Defensive: if the server ever omitted while answering about another run,
    // showing the old graph would draw the wrong picture confidently.
    const next = withGraph({
      id: "run-2",
      definition: null,
      definitionUnchanged: true,
    });

    expect(mergeRunGraph(withGraph(), next).definition).toBeNull();
  });

  it("survives having no previous run to merge from", () => {
    expect(mergeRunGraph(null, withGraph()).definition).toEqual(
      featurePlanningDefinition,
    );
  });
});
