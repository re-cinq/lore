import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./frontmatter";

const adr = `---
adr_number: 32
title: "Split the local MCP adapter"
status: draft
date: 2026-06-23
domains: [mcp-server, api, infra]
relates: "specs/split-local-remote-api/spec.md"
---

# ADR-032: Split

Lead paragraph.
`;

describe("parseFrontmatter", () => {
  it("parses scalars, stripping quotes", () => {
    const { meta } = parseFrontmatter(adr);

    expect(meta).toMatchObject({
      adr_number: "32",
      title: "Split the local MCP adapter",
      status: "draft",
      date: "2026-06-23",
      relates: "specs/split-local-remote-api/spec.md",
    });
  });

  it("parses a flow list into an array", () => {
    expect(parseFrontmatter(adr).meta.domains).toEqual([
      "mcp-server",
      "api",
      "infra",
    ]);
  });

  it("parses a block list into an array", () => {
    const source = "---\ndomains:\n  - floor\n  - web-ui\n---\n\n# T\n";

    expect(parseFrontmatter(source).meta.domains).toEqual(["floor", "web-ui"]);
  });

  it("drops a key with an empty scalar value and no block list following it", () => {
    const source = "---\nempty:\ntitle: T\n---\n\nBody.\n";

    expect(parseFrontmatter(source).meta).toEqual({ title: "T" });
  });

  it("returns the body starting right after the closing fence", () => {
    expect(parseFrontmatter(adr).body).toBe(
      "\n# ADR-032: Split\n\nLead paragraph.\n",
    );
  });

  it("returns empty meta and the full source when there is no frontmatter", () => {
    const source = "# Title\n\nProse.\n";

    expect(parseFrontmatter(source)).toEqual({ meta: {}, body: source });
  });

  it("ignores a later --- horizontal rule", () => {
    const source = "# Title\n\nProse.\n\n---\n\nMore.\n";

    expect(parseFrontmatter(source)).toEqual({ meta: {}, body: source });
  });
});
