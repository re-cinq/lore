import { describe, it, expect } from "vitest";
import { flattenSpecGraph } from "./spec-graph-flatten.js";

describe("flattenSpecGraph", () => {
  it("draws covers links when coverage is only listed once in the tests block, leaving it out of the per-statement block", () => {
    const graph = flattenSpecGraph({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "s.md",
          stmts: [
            {
              uid: "0x2",
              "Statement.text": "A",
              vb: [{ uid: "0xt1", "TestChunk.file_path": "a.test.ts" }],
            },
          ],
        },
      ],
      tests: [
        {
          uid: "0xt1",
          "TestChunk.file_path": "a.test.ts",
          cov: [
            {
              covers: [
                {
                  uid: "0xf1",
                  "File.path": "a.ts",
                  "Coverage.covers|ranges": "1-5",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(
      graph.links.find(
        (l) =>
          l.kind === "covers" &&
          l.source === "0xt1" &&
          l.target === "file|a.ts",
      ),
    ).toBeDefined();
  });
});
