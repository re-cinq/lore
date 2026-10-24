import { describe, it, expect } from "vitest";
import { serializeContext } from "./context-assembly-format.js";

describe("serializeContext", () => {
  it("omits empty sections from output", () => {
    const out = serializeContext(
      { query: "test", template: "default", budget: 1000 },
      [
        {
          header: "Empty Section",
          source: "adrs",
          priority: 1,
          truncated: false,
          documents: [],
        },
        {
          header: "Populated Section",
          source: "repo",
          priority: 2,
          truncated: false,
          documents: [
            {
              text: "content",
              tokens: 1,
              source_path: "file.md",
              content_type: "doc",
            },
          ],
        },
      ],
    );

    expect(out).not.toContain("Empty Section");
    expect(out).toContain("Populated Section");
  });
});
