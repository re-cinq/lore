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
    const emptyProxy = {
      proxyGet: async () => ({
        ok: true as const,
        body: JSON.stringify({ callers: [] }),
      }),
      detectRepo: () => "o/r",
    };
    const outEmpty = await runQueryTrace(
      { callers_of: "someSymbol" },
      emptyProxy,
    );
    const outEmptyCallees = await runQueryTrace(
      { callees_of: "someSymbol" },
      emptyProxy,
    );

    expect(outEmpty).toContain("No callers found for someSymbol.");
    expect(outEmptyCallees).toContain("No callees found for someSymbol.");
  });

  it("A callers query returns one line per caller with file and symbol", async () => {
    const populatedProxy = {
      proxyGet: async () => ({
        ok: true as const,
        body: JSON.stringify({
          callers: [
            { filePath: "src/a.ts", symbol: "funcA", startLine: 10 },
            { filePath: "src/b.ts", symbol: "funcB", startLine: 20 },
          ],
        }),
      }),
      detectRepo: () => "o/r",
    };
    const outCallers = await runQueryTrace(
      { callers_of: "someSymbol" },
      populatedProxy,
    );
    const outCallees = await runQueryTrace(
      { callees_of: "someSymbol" },
      populatedProxy,
    );

    expect(outCallers).toContain(
      "Callers of someSymbol (2):\n- src/a.ts:10 — funcA\n- src/b.ts:20 — funcB",
    );
    expect(outCallees).toContain(
      "Callees of someSymbol (2):\n- src/a.ts:10 — funcA\n- src/b.ts:20 — funcB",
    );
  });
});
