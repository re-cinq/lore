import { describe, it, expect } from "vitest";
import { summarizeMarkdown } from "./summarize-markdown.js";

describe("summarizeMarkdown", () => {
  it("returns the first heading text as title, stripping marker and whitespace", () => {
    const source = "# ADR-016: Dark Factory\n\nStatus: accepted\n\nWe will ...";

    expect(summarizeMarkdown(source).title).toBe("ADR-016: Dark Factory");
  });

  it("keeps the first heading as title when a second heading precedes any prose", () => {
    const source = "# First Title\n\n## Second Heading\n\nThe lead paragraph.\n";

    expect(summarizeMarkdown(source)).toEqual({
      title: "First Title",
      description: "The lead paragraph.",
    });
  });

  it("returns the first non-heading, non-blank line as description", () => {
    const source =
      "# ADR-016: Dark Factory\n\nWe will adopt a dark factory pipeline.\n\nMore detail follows.\n";

    expect(summarizeMarkdown(source).description).toBe(
      "We will adopt a dark factory pipeline.",
    );
  });

  it("skips YAML frontmatter so an ADR yields its H1 title and lead paragraph", () => {
    const source =
      '---\nadr_number: 16\ntitle: "Dark Factory"\nstatus: accepted\ndate: 2026-06-23\n---\n\n# ADR-016: Dark Factory\n\nWe will adopt a dark factory pipeline.\n\n## Context\n';

    expect(summarizeMarkdown(source)).toEqual({
      title: "ADR-016: Dark Factory",
      description: "We will adopt a dark factory pipeline.",
    });
  });

  it("treats a later --- as an hr, not frontmatter", () => {
    const source = "# Title\n\nLead paragraph.\n\n---\n\nAfter the rule.\n";

    expect(summarizeMarkdown(source).description).toBe("Lead paragraph.");
  });

  it("does not mistake a lone leading --- with no closing fence for frontmatter", () => {
    const source = "---\n# Title\nNo closing fence here.\n";

    expect(summarizeMarkdown(source)).toEqual({
      title: "Title",
      description: "---",
    });
  });
});
