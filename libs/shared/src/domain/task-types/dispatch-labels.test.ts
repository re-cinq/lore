import { describe, it, expect } from "vitest";
import {
  DISPATCH_LABELS,
  dispatchTypeFromLabels,
  issueDispatchTarget,
} from "./dispatch-labels.js";

describe("dispatchTypeFromLabels", () => {
  it("reads the backlog off a lore:implementation label", () => {
    expect(dispatchTypeFromLabels(["lore", "lore:implementation"])).toBe(
      "backlog",
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

describe("issueDispatchTarget", () => {
  it("sends an issue labelled only lore to the backlog when the repository configures no default", () => {
    expect(issueDispatchTarget(["lore", "bug"])).toBe("backlog");
  });

  it("sends an issue labelled only lore to a runbook task when the repository's default is runbook", () => {
    expect(issueDispatchTarget(["lore"], "runbook")).toBe("runbook");
  });

  it.each(["general", "implementation"])(
    "sends an issue to the backlog when the repository's default is still the removed %s type",
    (removed) => {
      expect(issueDispatchTarget(["lore"], removed)).toBe("backlog");
    },
  );

  it("lets a lore:review label win over the repository's runbook default", () => {
    expect(issueDispatchTarget(["lore", "lore:review"], "runbook")).toBe(
      "review",
    );
  });
});
