import { describe, it, expect } from "vitest";
import type { TraceDocument } from "@re-cinq/lore-shared";
import { formatTraceQuery, runQueryTrace } from "./query-trace.js";
import type { ProxyResult } from "../../outbound/proxy.js";

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
          {
            uid: "0x1",
            ordinal: 1,
            text: "tested normal",
            state: "tested",
            links: [],
          },
          {
            uid: "0x2",
            ordinal: 2,
            text: "is untested",
            state: "untested",
            links: [],
          },
          {
            uid: "0x3",
            ordinal: 3,
            text: "is drifted",
            state: "tested",
            drifted: true,
            links: [],
          },
          {
            uid: "0x4",
            ordinal: 4,
            text: "is violated",
            state: "tested",
            violated: true,
            links: [],
          },
        ],
        coverage: { testable: 3, covered: 2, untestable: 0, ratio: 2 / 3 },
      }),
    );

    expect(out).toContain("Auth");
    expect(out).toContain("2/3");
    const order = ["is violated", "is drifted", "is untested"].map((t) =>
      out.indexOf(t),
    );

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
              {
                kind: "test",
                label: "rotate.test.ts",
                path: "auth/rotate.test.ts",
                line: 12,
                detail: "rotates",
              },
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
          {
            uid: "0x1",
            ordinal: 1,
            text: "Token rotates",
            state: "tested",
            links: [],
          },
          {
            uid: "0x2",
            ordinal: 2,
            text: "Token revokes",
            state: "tested",
            links: [],
          },
          {
            uid: "0x3",
            ordinal: 3,
            text: "Session expires",
            state: "tested",
            links: [],
          },
        ],
      }),
      "token",
    );

    expect(out).toContain("Token rotates");
    expect(out).toContain("Token revokes");
    expect(out).not.toContain("Session expires");
  });

  it("with an empty document, returns a no-graph-data message rather than throwing", () => {
    expect(
      formatTraceQuery(doc({ statements: [], filePath: "specs/x/spec.md" })),
    ).toContain("specs/x/spec.md");
    expect(formatTraceQuery(doc({ statements: [] }))).toMatch(/no graph data/i);
  });

  it("with no selector and no violated, drifted, or untested statements, says so", () => {
    const out = formatTraceQuery(
      doc({
        statements: [
          {
            uid: "0x1",
            ordinal: 1,
            text: "all good",
            state: "tested",
            links: [],
          },
        ],
        coverage: { testable: 1, covered: 1, untestable: 0, ratio: 1 },
      }),
    );

    expect(out).toContain("No violated, drifted, or untested statements.");
  });

  it("with a selector matching nothing, returns a no-match message", () => {
    const out = formatTraceQuery(
      doc({
        filePath: "specs/auth/spec.md",
        statements: [
          {
            uid: "0x1",
            ordinal: 1,
            text: "token rotates",
            state: "tested",
            links: [],
          },
        ],
      }),
      "nonexistent-selector",
    );

    expect(out).toBe(
      'No statement in specs/auth/spec.md matches "nonexistent-selector".',
    );
  });
});

describe("runQueryTrace", () => {
  const okDoc: ProxyResult = {
    ok: true,
    body: JSON.stringify(
      doc({
        title: "Auth",
        statements: [
          {
            uid: "0x1",
            ordinal: 1,
            text: "is untested",
            state: "untested",
            links: [],
          },
        ],
        coverage: { testable: 1, covered: 0, untestable: 0, ratio: 0 },
      }),
    ),
  };

  it("proxies a GET to the repo's trace/document route and formats the result", async () => {
    let requested = "";
    const out = await runQueryTrace(
      { spec: "specs/auth/spec.md" },
      {
        proxyGet: async (p) => {
          requested = p;

          return okDoc;
        },
        detectRepo: () => "o/r",
      },
    );

    expect(requested).toBe(
      "/api/repos/o/r/trace/document?path=specs%2Fauth%2Fspec.md",
    );
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
      {
        proxyGet: async () => ({ ok: false, reason: "not_configured" }),
        detectRepo: () => null,
      },
    );

    expect(out).toMatch(/LORE_API_URL/);
  });

  it("surfaces a read-scope hint when the remote returns 403 insufficient scope", async () => {
    const out = await runQueryTrace(
      { repo: "o/r", spec: "specs/auth/spec.md" },
      {
        proxyGet: async () => ({
          ok: false,
          reason: "unreachable",
          detail: "HTTP 403 Forbidden",
        }),
        detectRepo: () => null,
      },
    );

    expect(out).toMatch(/scope/i);
    expect(out).toContain("403");
  });

  it("omits the scope hint for a non-403 unreachable error", async () => {
    const out = await runQueryTrace(
      { repo: "o/r", spec: "specs/auth/spec.md" },
      {
        proxyGet: async () => ({
          ok: false,
          reason: "unreachable",
          detail: "connect ECONNREFUSED",
        }),
        detectRepo: () => null,
      },
    );

    expect(out).toBe(
      "Lore API unreachable for lore-query-trace: connect ECONNREFUSED.",
    );
  });

  it("routes a callers_of query to a callers endpoint rather than the document endpoint", async () => {
    let calledPath = "";

    await runQueryTrace(
      { callers_of: "nextTransition" },
      {
        proxyGet: async (p) => {
          calledPath = p;

          return { ok: true, body: JSON.stringify(doc()) };
        },
        detectRepo: () => "o/r",
      },
    );
    expect(calledPath).toMatch(/callers|call-graph/);
  });
});

describe("runQueryTrace tests_covering", () => {
  const covering = (tests: unknown[]): ProxyResult => ({
    ok: true,
    body: JSON.stringify({ tests }),
  });

  it("renders one row per test file, marking the overlay row and the statement it validates", async () => {
    const out = await runQueryTrace(
      { repo: "o/r", tests_covering: "src/a.ts", ranges: "10-20" },
      {
        proxyGet: async () =>
          covering([
            { testFile: "src/a.test.ts", statement: "does a", origin: "main" },
            { testFile: "src/b.test.ts", origin: "overlay" },
          ]),
        detectRepo: () => null,
      },
    );

    expect(out).toBe(
      [
        "Tests covering src/a.ts (lines 10-20):",
        '- src/a.test.ts — validates: "does a"',
        "- src/b.test.ts — unlinked (overlay)",
      ].join("\n"),
    );
  });

  it("renders a no-tests-cover sentence for an empty list", async () => {
    const out = await runQueryTrace(
      { repo: "o/r", tests_covering: "src/a.ts" },
      { proxyGet: async () => covering([]), detectRepo: () => null },
    );

    expect(out).toBe("No tests cover src/a.ts.");
  });

  it("passes branch and ranges through to the proxied url, url-encoded", async () => {
    let requested = "";

    await runQueryTrace(
      {
        repo: "o/r",
        tests_covering: "src/a b.ts",
        ranges: "10-20,30-40",
        branch: "feat/x",
      },
      {
        proxyGet: async (p) => {
          requested = p;

          return covering([]);
        },
        detectRepo: () => null,
      },
    );

    expect(requested).toBe(
      "/api/repos/o/r/trace/tests-covering?path=src%2Fa+b.ts&ranges=10-20%2C30-40&branch=feat%2Fx",
    );
  });

  it("reports the proxy failure rather than throwing when the api is unreachable", async () => {
    const out = await runQueryTrace(
      { repo: "o/r", tests_covering: "src/a.ts" },
      {
        proxyGet: async () => ({
          ok: false,
          reason: "unreachable",
          detail: "connect ECONNREFUSED",
        }),
        detectRepo: () => null,
      },
    );

    expect(out).toBe(
      "Lore API unreachable for lore-query-trace: connect ECONNREFUSED.",
    );
  });
});

describe("runQueryTrace failures_touching", () => {
  const failing = (failures: unknown[]): ProxyResult => ({
    ok: true,
    body: JSON.stringify({ failures }),
  });

  const hit = {
    stationRunId: "sr-1",
    nodeId: "validate",
    iteration: 1,
    failureClass: "lint",
    failureDetail: "src/a.ts:12 no-unused-vars\n  at Linter.verify",
    commit: "a1b2c3d",
    occurredAt: "2026-09-09T10:00:00.000Z",
    resolvedByCommit: "e4f5a6b",
  };

  const ask = (proxyGet: (p: string) => Promise<ProxyResult>) =>
    runQueryTrace(
      { repo: "o/r", failures_touching: "src/a.ts" },
      { proxyGet, detectRepo: () => null },
    );

  it("lists each failure with its node, attempt, commit and the sha that fixed it", async () => {
    const out = await ask(async () => failing([hit]));

    expect(out).toBe(
      [
        "Failures recorded on src/a.ts (1), newest first:",
        "- [lint] validate #1 at a1b2c3d — src/a.ts:12 no-unused-vars — fixed by e4f5a6b",
      ].join("\n"),
    );
  });

  it("marks a failure with no resolving commit as still open", async () => {
    const out = await ask(async () =>
      failing([{ ...hit, resolvedByCommit: undefined }]),
    );

    expect(out).toContain("— still open");
  });

  it("renders a no-recorded-failures sentence for an empty list", async () => {
    const out = await ask(async () => failing([]));

    expect(out).toBe("No recorded failures on src/a.ts.");
  });

  it("truncates a detail longer than 120 characters to one capped line", async () => {
    const out = await ask(async () =>
      failing([{ ...hit, failureDetail: "x".repeat(200) }]),
    );

    expect(out).toContain(`${"x".repeat(120)}…`);
  });

  it("proxies a GET to the repo's failures-touching route with the path url-encoded", async () => {
    let requested = "";

    await ask(async (p) => {
      requested = p;

      return failing([]);
    });

    expect(requested).toBe(
      "/api/repos/o/r/trace/failures-touching?path=src%2Fa.ts",
    );
  });

  it("reports the proxy failure rather than throwing when the api is unreachable", async () => {
    const out = await ask(async () => ({
      ok: false,
      reason: "unreachable",
      detail: "connect ECONNREFUSED",
    }));

    expect(out).toBe(
      "Lore API unreachable for lore-query-trace: connect ECONNREFUSED.",
    );
  });
});
