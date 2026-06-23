import { describe, it, expect } from "vitest";
import type { TraceDocument } from "@re-cinq/lore-shared";
import { formatTraceQuery, runQueryTrace } from "./query-trace.js";
import type { ProxyResult } from "../../proxy.js";

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

describe("formatTraceQuery", () => {
  it("with no selector, lists coverage then violated, drifted, untested statements in that order", () => {
    const out = formatTraceQuery(
      doc({
        title: "Auth",
        statements: [
          { uid: "0x1", ordinal: 1, text: "tested normal", state: "tested", links: [] },
          { uid: "0x2", ordinal: 2, text: "is untested", state: "untested", links: [] },
          { uid: "0x3", ordinal: 3, text: "is drifted", state: "tested", drifted: true, links: [] },
          { uid: "0x4", ordinal: 4, text: "is violated", state: "tested", violated: true, links: [] },
        ],
        coverage: { testable: 3, covered: 2, untestable: 0, ratio: 2 / 3 },
      }),
    );

    expect(out).toContain("Auth");
    expect(out).toContain("2/3");
    const order = ["is violated", "is drifted", "is untested"].map((t) => out.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(out).not.toContain("tested normal");
  });

  it("with an ordinal selector, returns that statement with its test, code, and adr links grouped", () => {
    const out = formatTraceQuery(
      doc({
        statements: [
          { uid: "0x1", ordinal: 1, text: "first", state: "tested", links: [] },
          {
            uid: "0x2",
            ordinal: 2,
            text: "token rotates hourly",
            state: "tested",
            violated: true,
            links: [
              { kind: "test", label: "rotate.test.ts", path: "auth/rotate.test.ts", line: 12, detail: "rotates" },
              { kind: "code", label: "rotate", path: "src/auth.ts", line: 40 },
              { kind: "adr", label: "ADR-016", path: "adrs/ADR-016-dark.md" },
            ],
          },
        ],
      }),
      "2",
    );

    expect(out).toContain("token rotates hourly");
    expect(out).toContain("violated");
    expect(out).toContain("auth/rotate.test.ts:12");
    expect(out).toContain("src/auth.ts:40");
    expect(out).toContain("ADR-016");
    expect(out).not.toContain("first");
  });

  it("with a case-insensitive substring selector, returns every matching statement", () => {
    const out = formatTraceQuery(
      doc({
        statements: [
          { uid: "0x1", ordinal: 1, text: "Token rotates", state: "tested", links: [] },
          { uid: "0x2", ordinal: 2, text: "Token revokes", state: "tested", links: [] },
          { uid: "0x3", ordinal: 3, text: "Session expires", state: "tested", links: [] },
        ],
      }),
      "token",
    );

    expect(out).toContain("Token rotates");
    expect(out).toContain("Token revokes");
    expect(out).not.toContain("Session expires");
  });

  it("with an empty document, returns a no-graph-data message rather than throwing", () => {
    expect(formatTraceQuery(doc({ statements: [], filePath: "specs/x/spec.md" }))).toContain("specs/x/spec.md");
    expect(formatTraceQuery(doc({ statements: [] }))).toMatch(/no graph data/i);
  });
});

describe("runQueryTrace", () => {
  const okDoc: ProxyResult = {
    ok: true,
    body: JSON.stringify(doc({ title: "Auth", statements: [{ uid: "0x1", ordinal: 1, text: "is untested", state: "untested", links: [] }], coverage: { testable: 1, covered: 0, untestable: 0, ratio: 0 } })),
  };

  it("proxies a GET to the repo's trace/document route and formats the result", async () => {
    let requested = "";
    const out = await runQueryTrace(
      { spec: "specs/auth/spec.md" },
      { proxyGet: async (p) => { requested = p; return okDoc; }, detectRepo: () => "o/r" },
    );

    expect(requested).toBe("/api/repos/o/r/trace/document?path=specs%2Fauth%2Fspec.md");
    expect(out).toContain("is untested");
  });

  it("resolves the repo from detectRepo when repo is omitted, and reports when none is found", async () => {
    const noRepo = await runQueryTrace(
      { spec: "specs/auth/spec.md" },
      { proxyGet: async () => okDoc, detectRepo: () => null },
    );
    expect(noRepo).toMatch(/could not detect/i);
  });

  it("returns a not-configured message when no proxy is configured", async () => {
    const out = await runQueryTrace(
      { repo: "o/r", spec: "specs/auth/spec.md" },
      { proxyGet: async () => ({ ok: false, reason: "not_configured" }), detectRepo: () => null },
    );
    expect(out).toMatch(/LORE_API_URL/);
  });

  it("surfaces a read-scope hint when the remote returns 403 insufficient scope", async () => {
    const out = await runQueryTrace(
      { repo: "o/r", spec: "specs/auth/spec.md" },
      { proxyGet: async () => ({ ok: false, reason: "unreachable", detail: "HTTP 403 Forbidden" }), detectRepo: () => null },
    );
    expect(out).toMatch(/scope/i);
    expect(out).toContain("403");
  });
});
