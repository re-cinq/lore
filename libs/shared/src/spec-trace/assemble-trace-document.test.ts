import { describe, it, expect } from "vitest";
import { assembleTraceDocument } from "./assemble-trace-document.js";

describe("assembleTraceDocument", () => {
  it("orders statements by ordinal and derives state + coverage counts from the graph", () => {
    const doc = assembleTraceDocument({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          stmts: [
            {
              uid: "0xb",
              "Statement.ordinal": 2,
              "Statement.text": "B testable, unlinked",
              "Statement.testability": "testable",
            },
            {
              uid: "0xa",
              "Statement.ordinal": 1,
              "Statement.text": "A is validated",
              "Statement.testability": "testable",
              vb: [
                {
                  uid: "0xt",
                  "TestChunk.file_path": "a.test.ts",
                  "TestChunk.test_name": "covers A",
                  "TestChunk.start_line": 5,
                },
              ],
            },
            {
              uid: "0xc",
              "Statement.ordinal": 3,
              "Statement.text": "C is narrative",
              "Statement.testability": "untestable",
            },
          ],
        },
      ],
    });

    expect(doc.filePath).toBe("specs/auth/spec.md");
    expect(
      doc.statements.map((s) => ({ ordinal: s.ordinal, state: s.state })),
    ).toEqual([
      { ordinal: 1, state: "tested" },
      { ordinal: 2, state: "untested" },
      { ordinal: 3, state: "narrative" },
    ]);
    expect(doc.coverage).toEqual({
      testable: 2,
      covered: 1,
      untestable: 1,
      ratio: 0.5,
    });
  });

  it("counts a validated AcceptanceCriterion alongside a tested Statement in coverage", () => {
    const doc = assembleTraceDocument({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          stmts: [
            {
              uid: "0xa",
              "Statement.ordinal": 1,
              "Statement.text": "Token rotates hourly",
              "Statement.testability": "testable",
              vb: [
                {
                  uid: "0xt",
                  "TestChunk.file_path": "rotate.test.ts",
                  "TestChunk.test_name": "rotates",
                  "TestChunk.start_line": 5,
                },
              ],
            },
          ],
          acs: [
            {
              uid: "0xac1",
              "AcceptanceCriterion.ordinal": 1,
              "AcceptanceCriterion.text":
                "Given a gold user, when checkout, then 10% off",
              vb: [
                {
                  uid: "0xt2",
                  "TestChunk.file_path": "checkout.test.ts",
                  "TestChunk.test_name": "applies 10% for gold",
                  "TestChunk.start_line": 8,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(doc.coverage).toEqual({
      testable: 2,
      covered: 2,
      untestable: 0,
      ratio: 1,
    });
  });

  it("returns ordered sections and each statement's section ref, links, and drift/violation metadata", () => {
    const doc = assembleTraceDocument({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          sections: [
            {
              uid: "0xs2",
              "Section.heading": "Flows",
              "Section.ordinal": 2,
              "Section.level": 2,
            },
            {
              uid: "0xs1",
              "Section.heading": "Goals",
              "Section.ordinal": 1,
              "Section.level": 2,
            },
          ],
          stmts: [
            {
              uid: "0xa",
              "Statement.ordinal": 1,
              "Statement.text": "Token rotates hourly",
              "Statement.testability": "testable",
              "Statement.drifted": true,
              "Statement.violated": true,
              sec: { uid: "0xs1" },
              vb: [
                {
                  uid: "0xt",
                  "TestChunk.file_path": "auth/rotate.test.ts",
                  "TestChunk.test_name": "rotates",
                  "TestChunk.start_line": 12,
                },
              ],
              ib: [
                {
                  uid: "0xc",
                  "CodeChunk.file_path": "src/auth.ts",
                  "CodeChunk.symbol_name": "rotate",
                  "CodeChunk.start_line": 40,
                },
              ],
              db: [
                {
                  uid: "0xd",
                  "ADR.file_path": "adrs/ADR-016-dark.md",
                  "ADR.number": 16,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(doc.sections).toEqual([
      { uid: "0xs1", heading: "Goals", ordinal: 1, level: 2 },
      { uid: "0xs2", heading: "Flows", ordinal: 2, level: 2 },
    ]);
    expect(doc.statements[0]).toMatchObject({
      sectionUid: "0xs1",
      drifted: true,
      violated: true,
      links: [
        {
          kind: "test",
          label: "rotate.test.ts",
          path: "auth/rotate.test.ts",
          line: 12,
          detail: "rotates",
        },
        { kind: "code", label: "rotate", path: "src/auth.ts", line: 40 },
        { kind: "adr", label: "ADR-16", path: "adrs/ADR-016-dark.md" },
      ],
    });
  });

  it("sets title to the ordinal-first section heading 'Goals'", () => {
    const doc = assembleTraceDocument({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          sections: [
            {
              uid: "0xs2",
              "Section.heading": "Flows",
              "Section.ordinal": 2,
              "Section.level": 2,
            },
            {
              uid: "0xs1",
              "Section.heading": "Goals",
              "Section.ordinal": 1,
              "Section.level": 2,
            },
          ],
          stmts: [],
        },
      ],
    });

    expect(doc.title).toBe("Goals");
  });

  it("sets description to the ordinal-first statement's text 'First sentence.'", () => {
    const doc = assembleTraceDocument({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/auth/spec.md",
          stmts: [
            {
              uid: "0xb",
              "Statement.ordinal": 2,
              "Statement.text": "Second sentence.",
              "Statement.testability": "testable",
            },
            {
              uid: "0xa",
              "Statement.ordinal": 1,
              "Statement.text": "First sentence.",
              "Statement.testability": "testable",
            },
          ],
        },
      ],
    });

    expect(doc.description).toBe("First sentence.");
  });

  it("sets title to the spec H1 'Feature Specification: LoreTask CRD' over the first section heading", () => {
    const data = {
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/x/spec.md",
          "Spec.title": "Feature Specification: LoreTask CRD",
          sections: [{ uid: "0xs", "Section.heading": "Problem Statement" }],
          stmts: [],
        },
      ],
    };

    expect(assembleTraceDocument(data).title).toBe(
      "Feature Specification: LoreTask CRD",
    );
  });

  it("falls back title to the file basename 'spec.md' when the spec has no sections", () => {
    const doc = assembleTraceDocument({
      q: [
        {
          uid: "0x1",
          "Spec.file_path": "specs/onboarding/spec.md",
          sections: [],
          stmts: [
            {
              uid: "0xa",
              "Statement.ordinal": 1,
              "Statement.text": "Onboarding works.",
              "Statement.testability": "testable",
            },
          ],
        },
      ],
    });

    expect(doc.title).toBe("spec.md");
  });
});
