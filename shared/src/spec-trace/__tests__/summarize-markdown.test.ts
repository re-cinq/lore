import { describe, it, expect } from "vitest";
import { summarizeMarkdown } from "../summarize-markdown.js";

describe("summarizeMarkdown", () => {
  it("returns the first heading text as title, stripping marker and whitespace", () => {
    const source = "# ADR-016: Dark Factory\n\nStatus: accepted\n\nWe will ...";
    expect(summarizeMarkdown(source).title).toBe("ADR-016: Dark Factory");
  });

  it("returns the first non-heading, non-blank line as description", () => {
    const source = "# ADR-016: Dark Factory\n\nWe will adopt a dark factory pipeline.\n\nMore detail follows.\n";
    expect(summarizeMarkdown(source).description).toBe("We will adopt a dark factory pipeline.");
  });
});
