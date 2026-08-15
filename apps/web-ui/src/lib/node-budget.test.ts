import { describe, it, expect } from "vitest";
import { nodeBudgetMinutes } from "./node-budget";
import type { AssemblyLineDefinition } from "./assembly-line-definition";

const definition = (
  nodes: { id: string; type: string; timeout_minutes?: number }[],
): AssemblyLineDefinition =>
  ({
    name: "feature-planning",
    entry: "analyze",
    nodes,
    edges: [],
  }) as unknown as AssemblyLineDefinition;

describe("nodeBudgetMinutes", () => {
  it("adds the reaper's grace to a node's declared timeout", () => {
    expect(
      nodeBudgetMinutes(
        definition([{ id: "write", type: "agent", timeout_minutes: 30 }]),
        "write",
      ),
    ).toEqual(32);
  });

  it("falls back to the reaper's own default for a node that declares none", () => {
    expect(
      nodeBudgetMinutes(
        definition([{ id: "analyze", type: "agent" }]),
        "analyze",
      ),
    ).toEqual(62);
  });

  it("gives each node its own budget rather than one number for the line", () => {
    const def = definition([
      { id: "analyze", type: "agent", timeout_minutes: 15 },
      { id: "write", type: "agent", timeout_minutes: 45 },
    ]);

    expect(nodeBudgetMinutes(def, "analyze")).toEqual(17);
    expect(nodeBudgetMinutes(def, "write")).toEqual(47);
  });

  it("returns null for a human station, which is parked rather than running", () => {
    expect(
      nodeBudgetMinutes(
        definition([{ id: "author", type: "feature_review" }]),
        "author",
      ),
    ).toEqual(null);
  });

  it("returns null when no definition resolved", () => {
    expect(nodeBudgetMinutes(null, "analyze")).toEqual(null);
  });

  it("returns null for a node the definition does not declare", () => {
    expect(
      nodeBudgetMinutes(
        definition([{ id: "analyze", type: "agent" }]),
        "ghost",
      ),
    ).toEqual(null);
  });

  it("returns null without a node id, since the line has no single budget", () => {
    expect(
      nodeBudgetMinutes(
        definition([{ id: "analyze", type: "agent" }]),
        undefined,
      ),
    ).toEqual(null);
  });
});
