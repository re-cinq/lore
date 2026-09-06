import { describe, it, expect } from "vitest";
import { DISPATCH_LABELS, dispatchTypeFromLabels } from "./dispatch-labels.js";

describe("dispatchTypeFromLabels", () => {
  it("reads implementation off a lore:implementation label", () => {
    expect(dispatchTypeFromLabels(["lore", "lore:implementation"])).toBe(
      "implementation",
    );
  });

  it("answers null for labels naming no task type, leaving the default to the caller", () => {
    expect(dispatchTypeFromLabels(["lore", "bug"])).toBeNull();
    expect(dispatchTypeFromLabels([])).toBeNull();
  });

  it("resolves a mislabelled issue carrying two dispatch labels in declaration order", () => {
    expect(dispatchTypeFromLabels(["lore:runbook", "lore:review"])).toBe(
      "review",
    );
  });

  it("gives every seeded label a task type it can dispatch to", () => {
    for (const label of DISPATCH_LABELS) {
      expect(dispatchTypeFromLabels([label.name])).toBe(label.taskType);
    }
  });
});
