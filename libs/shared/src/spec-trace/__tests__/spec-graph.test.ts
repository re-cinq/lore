import { describe, it, expect } from "vitest";
import {
  flattenSpecGraph,
  specLabel,
  flattenSpecRing,
  UNGROUPED_SECTION,
} from "../spec-graph.js";

describe("flattenSpecRing", () => {
  it("counts per-section coverage and tags each statement tested by validated_by", () => {
    const ring = flattenSpecRing({
      q: [
        {
          uid: "0x1",
          sections: [{ uid: "0xs", "Section.heading": "Overview" }],
          stmts: [
            {
              uid: "0xa",
              v: 1,
              "Statement.text": "Tested one.",
              sec: { uid: "0xs" },
            },
            {
              uid: "0xb",
              v: 0,
              "Statement.text": "Untested one.",
              sec: { uid: "0xs" },
            },
            { uid: "0xc", v: 2, "Statement.text": "No section but tested." },
          ],
        },
      ],
    });
    expect(ring.sections).toEqual([
      { uid: "0xs", heading: "Overview", total: 2, tested: 1 },
      { uid: UNGROUPED_SECTION, heading: "(ungrouped)", total: 1, tested: 1 },
    ]);
    expect(ring.statements).toEqual([
      { uid: "0xa", sectionUid: "0xs", tested: true, text: "Tested one." },
      { uid: "0xb", sectionUid: "0xs", tested: false, text: "Untested one." },
      {
        uid: "0xc",
        sectionUid: UNGROUPED_SECTION,
        tested: true,
        text: "No section but tested.",
      },
    ]);
  });

  it("returns empty rings for empty input", () => {
    expect(flattenSpecRing({})).toEqual({ sections: [], statements: [] });
  });
});

describe("specLabel", () => {
  it("derives '<dir> (<doc>)' from a spec path", () => {
    expect(specLabel("specs/1-lore-platform/spec.md")).toBe(
      "1-lore-platform (spec)",
    );
    expect(specLabel("specs/1-lore-platform/data-model.md")).toBe(
      "1-lore-platform (data-model)",
    );
  });
  it("falls back to the doc name when there is no directory", () => {
    expect(specLabel(".specify/spec.md")).toBe("spec");
  });
});

describe("flattenSpecGraph", () => {
  it("flattens specs + linked statements into nodes with clean labels + popover metadata", () => {
    const graph = flattenSpecGraph({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          stmts: [
            {
              uid: "0x2",
              "Statement.text": "Returns the value.",
              vb: [
                {
                  uid: "0x3",
                  "TestChunk.file_path": "src/x.test.ts",
                  "TestChunk.start_line": 42,
                  "TestChunk.test_name": "returns value",
                },
              ],
              ib: [
                {
                  uid: "0x4",
                  "CodeChunk.file_path": "src/x.ts",
                  "CodeChunk.start_line": 10,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(graph.nodes).toEqual([
      {
        id: "0x1",
        type: "Spec",
        label: "auth (spec)",
        path: "specs/auth/spec.md",
      },
      {
        id: "0x2",
        type: "Statement",
        label: "",
        path: "specs/auth/spec.md",
        detail: "Returns the value.",
      },
      {
        id: "0x3",
        type: "TestChunk",
        label: "x.test.ts",
        path: "src/x.test.ts",
        line: 42,
        detail: "returns value",
      },
      { id: "file|src/x.ts", type: "File", label: "x.ts", path: "src/x.ts" },
    ]);
    expect(graph.links).toEqual([
      { source: "0x1", target: "0x2", kind: "in_spec" },
      { source: "0x2", target: "0x3", kind: "validated_by" },
      { source: "0x2", target: "file|src/x.ts", kind: "implemented_by" },
    ]);
  });

  it("links a TestChunk to the File its coverage covers, with the ranges facet as detail", () => {
    const graph = flattenSpecGraph({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          stmts: [
            {
              uid: "0x2",
              "Statement.text": "Returns the value.",
              vb: [
                {
                  uid: "0x3",
                  "TestChunk.file_path": "src/x.test.ts",
                  "TestChunk.test_name": "returns value",
                  cov: {
                    covers: [
                      {
                        uid: "0x5",
                        "File.path": "src/x.ts",
                        "Coverage.covers|ranges": "10-20,30-40",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(graph.nodes).toContainEqual({
      id: "file|src/x.ts",
      type: "File",
      label: "x.ts",
      path: "src/x.ts",
      detail: "10-20,30-40",
    });
    expect(graph.links).toContainEqual({
      source: "0x3",
      target: "file|src/x.ts",
      kind: "covers",
    });
  });

  it("de-duplicates a File covered by two TestChunks (by path)", () => {
    const graph = flattenSpecGraph({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "s.md",
          stmts: [
            {
              uid: "0x2",
              "Statement.text": "A",
              vb: [
                {
                  uid: "0x3",
                  "TestChunk.file_path": "a.test.ts",
                  cov: {
                    covers: [
                      {
                        uid: "0x9",
                        "File.path": "x.ts",
                        "Coverage.covers|ranges": "1-5",
                      },
                    ],
                  },
                },
                {
                  uid: "0x4",
                  "TestChunk.file_path": "b.test.ts",
                  cov: {
                    covers: [
                      {
                        uid: "0xA",
                        "File.path": "x.ts",
                        "Coverage.covers|ranges": "1-5",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(graph.nodes.filter((n) => n.id === "file|x.ts")).toHaveLength(1);
    expect(graph.links.filter((l) => l.kind === "covers")).toEqual([
      { source: "0x3", target: "file|x.ts", kind: "covers" },
      { source: "0x4", target: "file|x.ts", kind: "covers" },
    ]);
  });

  it("de-duplicates a TestChunk shared by two statements", () => {
    const graph = flattenSpecGraph({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "s.md",
          stmts: [
            {
              uid: "0x2",
              "Statement.text": "A",
              vb: [{ uid: "0x9", "TestChunk.file_path": "t.test.ts" }],
            },
            {
              uid: "0x3",
              "Statement.text": "B",
              vb: [{ uid: "0x9", "TestChunk.file_path": "t.test.ts" }],
            },
          ],
        },
      ],
    });
    expect(graph.nodes.filter((n) => n.id === "0x9")).toHaveLength(1);
  });

  it("groups specs under their shared Feature node via in_feature links", () => {
    const graph = flattenSpecGraph({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          feature: { uid: "0xF", "Feature.path": "specs/auth" },
          stmts: [],
        },
        {
          uid: "0x2",
          "Spec.file_path": "specs/auth/plan.md",
          feature: { uid: "0xF", "Feature.path": "specs/auth" },
          stmts: [],
        },
      ],
    });
    expect(graph.nodes.filter((n) => n.id === "0xF")).toEqual([
      { id: "0xF", type: "Feature", label: "auth", path: "specs/auth" },
    ]);
    expect(graph.links.filter((l) => l.kind === "in_feature")).toEqual([
      { source: "0xF", target: "0x1", kind: "in_feature" },
      { source: "0xF", target: "0x2", kind: "in_feature" },
    ]);
  });

  it("emits an AcceptanceCriterion node linked in_spec and to its validated_by TestChunk", () => {
    const graph = flattenSpecGraph({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          acs: [
            {
              uid: "0xac",
              "AcceptanceCriterion.text": "crit",
              vb: [
                {
                  uid: "0xt",
                  "TestChunk.file_path": "a.test.ts",
                  "TestChunk.test_name": "t",
                  "TestChunk.start_line": 5,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ id: "0xac", type: "AcceptanceCriterion" }),
    );
    expect(graph.links).toContainEqual({
      source: "0x1",
      target: "0xac",
      kind: "in_spec",
    });
    expect(graph.links).toContainEqual({
      source: "0xac",
      target: "0xt",
      kind: "validated_by",
    });
  });

  it("returns an empty graph for empty input", () => {
    expect(flattenSpecGraph({})).toEqual({ nodes: [], links: [] });
  });
});
