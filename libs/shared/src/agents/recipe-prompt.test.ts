import { describe, it, expect } from "vitest";
import { CONTEXT_BOOTSTRAP } from "./recipe-prompt.js";

describe("CONTEXT_BOOTSTRAP", () => {
  it("names lore_assemble_context and lore_search_memory in that order", () => {
    expect(CONTEXT_BOOTSTRAP.indexOf("lore_assemble_context")).toBeLessThan(
      CONTEXT_BOOTSTRAP.indexOf("lore_search_memory"),
    );
  });

  it("says nothing is pre-loaded, the one fact the installed skill cannot know", () => {
    expect(CONTEXT_BOOTSTRAP).toContain("nothing is pre-loaded");
  });

  it("carries no {placeholder} the subsystem would ship to the model verbatim", () => {
    // This string is a PARAMETER VALUE, not a template: the subsystem substitutes
    // recipe placeholders once, from spec.parameters, and never re-scans what it
    // substituted in. A `{repo}` written here would reach the model as those seven
    // characters — the same way an empty `context` parameter used to ship `{context}`.
    expect(CONTEXT_BOOTSTRAP).not.toMatch(/\{[A-Za-z0-9_.-]+\}/);
  });
});
