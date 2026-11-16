import { describe, it, expect } from "vitest";
import { formatTraceQuery, runQueryTrace } from "./query-trace.js";
import type { TraceDocument } from "@re-cinq/lore-shared";

function doc(overrides: Partial<TraceDocument> = {}): TraceDocument {
  return {
    filePath: "specs/auth/spec.md",
    title: "Auth",
    description: "",
    sections: [],
    statements: [],
    coverage: { testable: 0, covered: 0, untestable: 0, ratio: 0 },
    ...overrides,
  };
}

describe("formatTraceQuery acceptance", () => {
  it("when given a statement selector on a document with no graph data, answers with a no-graph-data message rather than no-matches", () => {
    const out = formatTraceQuery(doc({ statements: [] }), "some-selector");

    expect(out).toContain("No graph data for specs/auth/spec.md");
    expect(out).not.toContain("No statement in");
  });
});

describe("runQueryTrace acceptance", () => {
  it("A callers query returns 'no callers found' when empty", async () => {
    const outEmpty = await runQueryTrace(
      { callers_of: "someSymbol" },
      {
        proxyGet: async () => ({
          ok: true,
          body: JSON.stringify({ callers: [] }),
        }),
        detectRepo: () => "o/r",
      },
    );

    expect(outEmpty).toContain("No callers found for someSymbol.");
  });

  it("A callers query returns one line per caller with file and symbol", async () => {
    const outCallers = await runQueryTrace(
      { callers_of: "someSymbol" },
      {
        proxyGet: async () => ({
          ok: true,
          body: JSON.stringify({
            callers: [
              { filePath: "src/a.ts", symbol: "funcA", startLine: 10 },
              { filePath: "src/b.ts", symbol: "funcB", startLine: 20 },
            ],
          }),
        }),
        detectRepo: () => "o/r",
      },
    );

    expect(outCallers).toContain(
      "Callers of someSymbol (2):\n- src/a.ts:10 — funcA\n- src/b.ts:20 — funcB",
    );
  });
});
