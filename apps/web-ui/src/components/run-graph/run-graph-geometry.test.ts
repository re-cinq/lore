import { describe, it, expect } from "vitest";
import {
  fitNodeLabel,
  nodeHeightFor,
  toLayoutDefinition,
  NODE_LABEL_CHARS,
  NODE_WIDTH,
} from "./run-graph-geometry";
import type { VisibleGraph } from "@/lib/graph-view-model";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";

const node = (id: string, outcomes: readonly string[] = []) => ({
  id,
  type: "agent",
  outcomes,
  verdict: null,
  status: "idle" as const,
  result: null,
});

const graph = (over: Partial<VisibleGraph> = {}): VisibleGraph => ({
  mode: "run",
  nodes: [],
  edges: [],
  ...over,
});

describe("fitNodeLabel", () => {
  it("keeps 'Waiting for the spec PR' whole — the longest badge the spec ships", () => {
    expect(fitNodeLabel("Waiting for the spec PR")).toEqual(
      "Waiting for the spec PR",
    );
  });

  it("keeps 'Waiting for you' whole", () => {
    expect(fitNodeLabel("Waiting for you")).toEqual("Waiting for you");
  });

  it("clips a label longer than the box to an ellipsis at the budget", () => {
    const clipped = fitNodeLabel("x".repeat(NODE_LABEL_CHARS + 10));

    expect(clipped).toEqual(`${"x".repeat(NODE_LABEL_CHARS - 1)}…`);
    expect(clipped.length).toEqual(NODE_LABEL_CHARS);
  });

  it("drops the space before an ellipsis that lands on a word break", () => {
    expect(fitNodeLabel("abcd efghij", 6)).toEqual("abcd…");
  });

  it("leaves a label exactly at the budget unclipped", () => {
    const exact = "y".repeat(NODE_LABEL_CHARS);

    expect(fitNodeLabel(exact)).toEqual(exact);
  });

  it("fits the spec's longest badge inside the box it is drawn in", () => {
    expect("Waiting for the spec PR".length).toBeLessThanOrEqual(
      NODE_LABEL_CHARS,
    );
    expect(NODE_WIDTH).toBeGreaterThanOrEqual(216);
  });
});

describe("nodeHeightFor", () => {
  it("uses the base height outside definition mode", () => {
    expect(nodeHeightFor(graph({ mode: "run", nodes: [node("a")] }))).toEqual(
      48,
    );
  });

  it("uses the base height in definition mode when no node lists outcomes", () => {
    expect(
      nodeHeightFor(graph({ mode: "definition", nodes: [node("a")] })),
    ).toEqual(48);
  });

  it("grows to fit the widest outcome list in definition mode", () => {
    expect(
      nodeHeightFor(
        graph({
          mode: "definition",
          nodes: [node("a", ["success", "failed"]), node("b")],
        }),
      ),
    ).toEqual(48 + 14 + 2 * 15);
  });
});

describe("toLayoutDefinition", () => {
  it("falls back to a synthesized name, entry and exit when no definition is given", () => {
    const layout = toLayoutDefinition(
      graph({ nodes: [node("first"), node("second")] }),
      null,
    );

    expect(layout.name).toEqual("workflow");
    expect(layout.entry).toEqual("first");
    expect(layout.exit).toEqual("");
  });

  it("falls back to an empty entry when there is no definition and no nodes", () => {
    const layout = toLayoutDefinition(graph({ nodes: [] }), null);

    expect(layout.entry).toEqual("");
  });

  it("uses the given definition's own name, entry and exit", () => {
    const definition: AssemblyLineDefinition = {
      name: "code-review",
      description: "",
      version: 1,
      entry: "review",
      exit: "done",
      nodes: [],
      edges: [],
    };
    const layout = toLayoutDefinition(
      graph({ nodes: [node("review")] }),
      definition,
    );

    expect(layout.name).toEqual("code-review");
    expect(layout.entry).toEqual("review");
    expect(layout.exit).toEqual("done");
  });
});
