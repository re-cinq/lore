import { describe, it, expect } from "vitest";
import {
  buildContainmentForest,
  ancestorChain,
  bundleControlIds,
} from "./edge-bundling";

const CONTAINMENT = new Set([
  "in_feature",
  "in_spec",
  "in_section",
  "has_statement",
]);

describe("buildContainmentForest", () => {
  it("maps a Spec child to its Feature parent via in_feature", () => {
    const parent = buildContainmentForest(
      [{ source: "feat", target: "spec", kind: "in_feature" }],
      CONTAINMENT,
    );

    expect(parent.get("spec")).toBe("feat");
  });

  it("maps a Statement to its Spec via in_spec", () => {
    const parent = buildContainmentForest(
      [{ source: "spec", target: "stmt", kind: "in_spec" }],
      CONTAINMENT,
    );

    expect(parent.get("stmt")).toBe("spec");
  });

  it("ignores cross-cutting kinds", () => {
    const parent = buildContainmentForest(
      [{ source: "stmt", target: "test", kind: "validated_by" }],
      CONTAINMENT,
    );

    expect(parent.has("test")).toBe(false);
    expect(parent.size).toBe(0);
  });
});

describe("ancestorChain", () => {
  it("returns self then each ancestor up to the root", () => {
    const parent = new Map([
      ["stmt", "spec"],
      ["spec", "feat"],
    ]);

    expect(ancestorChain(parent, "stmt")).toEqual(["stmt", "spec", "feat"]);
  });

  it("returns just the id for a node with no parent", () => {
    expect(ancestorChain(new Map(), "lonely")).toEqual(["lonely"]);
  });

  it("stops on a cycle instead of looping", () => {
    const parent = new Map([
      ["a", "b"],
      ["b", "a"],
    ]);

    expect(ancestorChain(parent, "a")).toEqual(["a", "b"]);
  });
});

describe("bundleControlIds", () => {
  // feat ⊃ {specA ⊃ stmtA, specB ⊃ stmtB}
  const parent = new Map([
    ["specA", "feat"],
    ["specB", "feat"],
    ["stmtA", "specA"],
    ["stmtB", "specB"],
  ]);

  it("routes an edge between two specs through their lowest common ancestor", () => {
    expect(bundleControlIds(parent, "stmtA", "stmtB")).toEqual([
      "stmtA",
      "specA",
      "feat",
      "specB",
      "stmtB",
    ]);
  });

  it("orders control ids source then LCA then target", () => {
    expect(bundleControlIds(parent, "stmtA", "feat")).toEqual([
      "stmtA",
      "specA",
      "feat",
    ]);
  });

  it("returns just the endpoints when there is no common ancestor", () => {
    expect(bundleControlIds(parent, "stmtA", "orphan")).toEqual([
      "stmtA",
      "orphan",
    ]);
  });
});
