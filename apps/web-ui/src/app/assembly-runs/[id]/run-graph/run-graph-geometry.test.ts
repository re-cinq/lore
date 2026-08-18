import { describe, it, expect } from "vitest";
import {
  fitNodeLabel,
  NODE_LABEL_CHARS,
  NODE_WIDTH,
} from "./run-graph-geometry";

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
