import { describe, expect, it } from "vitest";
import { specHeading } from "./spec-summary.js";

describe("specHeading", () => {
  it("returns Widget for the heading # Widget", () => {
    expect(specHeading("Intro.\n\n# Widget\n\n## Requirements\n")).toBe(
      "Widget",
    );
  });

  it("returns Widget for the heading # Feature Specification: Widget", () => {
    expect(specHeading("# Feature Specification: Widget\n")).toBe("Widget");
  });

  it("returns undefined for a spec with only a second-level heading", () => {
    expect(specHeading("## Requirements\n\n- A MUST hold.\n")).toBeUndefined();
  });

  it("returns undefined for a heading that holds only the prefix", () => {
    expect(specHeading("# Feature Specification:\n")).toBeUndefined();
  });
});
