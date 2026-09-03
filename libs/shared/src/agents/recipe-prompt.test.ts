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
    // A literal placeholder here would ship to the model verbatim: substitution runs once and never re-scans its own output.
    expect(CONTEXT_BOOTSTRAP).not.toMatch(/\{[A-Za-z0-9_.-]+\}/);
  });
});
