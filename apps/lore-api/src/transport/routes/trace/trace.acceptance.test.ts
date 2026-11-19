import { describe, it, expect } from "vitest";
import { traceRoute } from "./trace.js";
import { getResponseMeta } from "../../http/zod-response.js";
import { optionsOf } from "../../openapi/operation-responses.js";

const validKindPayloads = [
  { specs: ["specs/a/spec.md"] },
  {
    summaries: [
      {
        filePath: "specs/a/spec.md",
        title: "Spec A",
        description: "Lead",
        coverage: { testable: 1, covered: 1, untestable: 0, ratio: 1 },
        status: { status: "shipped", label: "Shipped" },
      },
    ],
  },
  { adrs: ["adrs/ADR-001.md"] },
  {
    summaries: [
      {
        filePath: "adrs/ADR-001.md",
        title: "ADR 1",
        description: "Context",
        status: null,
      },
    ],
  },
  {
    filePath: "specs/a/spec.md",
    title: "Spec A",
    description: "Lead",
    sections: [{ uid: "0x1", heading: "Intro", ordinal: 0, level: 2 }],
    statements: [
      {
        uid: "0x2",
        ordinal: 0,
        text: "Must work",
        kind: "requirement",
        testability: "testable",
        sectionUid: "0x1",
        state: "tested",
        links: [
          { kind: "test", label: "a.test.ts", path: "a.test.ts", line: 1 },
        ],
      },
    ],
    coverage: { testable: 1, covered: 1, untestable: 0, ratio: 1 },
  },
  { source: "# Spec A\n" },
  {
    nodes: [
      { id: "0x1", type: "Spec", label: "Spec A", path: "specs/a/spec.md" },
    ],
    links: [{ source: "0x1", target: "0x2", kind: "has_statement" }],
  },
  {
    sections: [{ uid: "0x1", heading: "Intro", total: 1, tested: 1 }],
    statements: [
      { uid: "0x2", sectionUid: "0x1", tested: true, text: "Must work" },
    ],
  },
  {
    tests: [
      {
        testFile: "src/a.test.ts",
        statement: "Must work",
        origin: "main",
        ranges: [[1, 10]],
      },
    ],
  },
  {
    failures: [
      {
        stationRunId: "sr-1",
        nodeId: "validate",
        iteration: 1,
        failureClass: "lint",
        failureDetail: "err",
        commit: "abc",
        occurredAt: "2026-01-01T00:00:00Z",
      },
    ],
  },
  { callers: [{ filePath: "src/a.ts", symbol: "fn", startLine: 5 }] },
];

describe("trace", () => {
  it("declares strict response schemas for trace shapes", () => {
    const route = traceRoute();
    const meta = getResponseMeta(optionsOf(route).plugins);

    expect(meta).toBeDefined();

    const invalidDocumentPayload = {
      sections: "not-an-array",
      statements: [],
      coverage: {
        testable: "not-a-number",
      },
    };

    const result = meta!.schema.safeParse(invalidDocumentPayload);

    expect(result.success).toBe(false);
    expect(
      validKindPayloads.every(
        (payload) => meta!.schema.safeParse(payload).success,
      ),
    ).toBe(true);
  });
});
