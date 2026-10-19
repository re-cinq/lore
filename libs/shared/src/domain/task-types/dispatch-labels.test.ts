import { describe, it, expect } from "vitest";
import { DISPATCH_LABELS } from "./dispatch-labels.js";

describe("DISPATCH_LABELS", () => {
  it("seeds only lore:implementation, the label that means the loop's backlog", () => {
    expect(DISPATCH_LABELS.map((label) => label.name)).toEqual([
      "lore:implementation",
    ]);
  });
});
