import { describe, it, expect } from "vitest";
import { assembleGraphContext, fetchGraphContext } from "../graph-context.js";

describe("assembleGraphContext", () => {
  it("ranks statements violated > drifted > untested > normal and dedups by xid", () => {
    const block = assembleGraphContext({
      q: [
        {
          uid: "0xn",
          "Statement.xid": "r|s|4",
          "Statement.text": "normal tested",
          "Statement.testability": "testable",
          spec: { "Spec.file_path": "specs/auth/spec.md", "Spec.title": "Auth" },
          vb: [{ "TestChunk.file_path": "auth.test.ts", "TestChunk.test_name": "ok", "TestChunk.start_line": 3 }],
        },
        {
          uid: "0xu",
          "Statement.xid": "r|s|3",
          "Statement.text": "untested testable",
          "Statement.testability": "testable",
          spec: { "Spec.file_path": "specs/auth/spec.md", "Spec.title": "Auth" },
        },
        {
          uid: "0xd",
          "Statement.xid": "r|s|2",
          "Statement.text": "drifted",
          "Statement.testability": "testable",
          "Statement.drifted": true,
          spec: { "Spec.file_path": "specs/auth/spec.md", "Spec.title": "Auth" },
          vb: [{ "TestChunk.file_path": "drift.test.ts", "TestChunk.test_name": "d", "TestChunk.start_line": 9 }],
        },
        {
          uid: "0xv",
          "Statement.xid": "r|s|1",
          "Statement.text": "violated",
          "Statement.testability": "testable",
          "Statement.violated": true,
          spec: { "Spec.file_path": "specs/auth/spec.md", "Spec.title": "Auth" },
          vb: [{ "TestChunk.file_path": "viol.test.ts", "TestChunk.test_name": "v", "TestChunk.start_line": 1 }],
        },
        {
          uid: "0xv2",
          "Statement.xid": "r|s|1",
          "Statement.text": "violated (seen via second seed)",
          "Statement.testability": "testable",
          "Statement.violated": true,
          spec: { "Spec.file_path": "specs/auth/spec.md", "Spec.title": "Auth" },
        },
      ],
    });

    expect(block.statements.map((s) => ({ xid: s.xid, signal: s.signal }))).toEqual([
      { xid: "r|s|1", signal: "violated" },
      { xid: "r|s|2", signal: "drifted" },
      { xid: "r|s|3", signal: "untested" },
      { xid: "r|s|4", signal: "normal" },
    ]);
  });

  it("classifies an untestable statement as normal regardless of links", () => {
    const block = assembleGraphContext({
      q: [
        {
          uid: "0xa",
          "Statement.xid": "r|s|1",
          "Statement.text": "narrative",
          "Statement.testability": "untestable",
          spec: { "Spec.file_path": "specs/auth/spec.md", "Spec.title": "Auth" },
        },
      ],
    });

    expect(block.statements[0].signal).toBe("normal");
  });

  it("collects per-statement links and distinct block-level adrRefs and testSelectors", () => {
    const block = assembleGraphContext({
      q: [
        {
          uid: "0xa",
          "Statement.xid": "r|s|1",
          "Statement.text": "rotate token",
          "Statement.testability": "testable",
          "Statement.violated": true,
          spec: { "Spec.file_path": "specs/auth/spec.md", "Spec.title": "Auth" },
          section: { "Section.heading": "Goals" },
          vb: [{ "TestChunk.file_path": "auth/rotate.test.ts", "TestChunk.test_name": "rotates", "TestChunk.start_line": 12 }],
          db: [{ "ADR.file_path": "adrs/ADR-016-dark.md" }],
        },
        {
          uid: "0xb",
          "Statement.xid": "r|s|2",
          "Statement.text": "revoke token",
          "Statement.testability": "testable",
          spec: { "Spec.file_path": "specs/auth/spec.md", "Spec.title": "Auth" },
          vb: [{ "TestChunk.file_path": "auth/rotate.test.ts", "TestChunk.test_name": "revokes", "TestChunk.start_line": 30 }],
          db: [{ "ADR.file_path": "adrs/ADR-016-dark.md" }],
        },
      ],
    });

    expect(block.statements[0]).toMatchObject({
      section: "Goals",
      adrs: [{ label: "ADR-016", path: "adrs/ADR-016-dark.md" }],
      testSelectors: ["auth/rotate.test.ts"],
    });
    expect(block.adrRefs).toEqual(["adrs/ADR-016-dark.md"]);
    expect(block.testSelectors).toEqual(["auth/rotate.test.ts"]);
  });

  it("keeps the highest-signal limit statements and reports truncated when over budget", () => {
    const block = assembleGraphContext(
      {
        q: [
          { uid: "0xn", "Statement.xid": "n", "Statement.text": "normal", "Statement.testability": "testable", vb: [{ "TestChunk.file_path": "n.test.ts" }] },
          { uid: "0xu", "Statement.xid": "u", "Statement.text": "untested", "Statement.testability": "testable" },
          { uid: "0xv", "Statement.xid": "v", "Statement.text": "violated", "Statement.testability": "testable", "Statement.violated": true },
        ],
      },
      { limit: 2 },
    );

    expect(block.statements.map((s) => s.xid)).toEqual(["v", "u"]);
    expect(block.truncated).toBe(true);
  });

  it("projects an empty result to an empty block", () => {
    expect(assembleGraphContext({})).toEqual({ statements: [], adrRefs: [], testSelectors: [], truncated: false });
  });
});

describe("fetchGraphContext", () => {
  it("degrades to an empty block when no dgraph client is given", async () => {
    expect(await fetchGraphContext(null, "any/repo")).toEqual({
      statements: [],
      adrRefs: [],
      testSelectors: [],
      truncated: false,
    });
  });
});
