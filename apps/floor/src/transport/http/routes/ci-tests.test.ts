import { describe, it, expect, afterEach, vi } from "vitest";
import { InMemoryTestReports } from "@re-cinq/lore-shared/project/test-reports/test-reports-memory.js";
import { buildServer } from "../server.js";
import { insertEventList } from "../../../outbound/event-store.js";

vi.mock("../../../outbound/event-store.js", () => ({
  insertEventList: vi.fn(),
}));

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  vi.mocked(insertEventList).mockReset();

  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;

    return;
  }
  process.env.LORE_INGEST_TOKEN = ORIG;
});

const authed = (payload: string, testReports = new InMemoryTestReports()) =>
  buildServer({
    getJobStatus: () => ({}),
    testReports,
    defaultBranch: async () => "main",
  }).inject({
    method: "POST",
    url: "/api/webhook/ci-tests",
    headers: { authorization: "Bearer right-token" },
    payload,
  });

describe("POST /api/webhook/ci-tests", () => {
  it("returns 202 and queues the report as one test-report spec_trace event", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const res = await authed(
      JSON.stringify({
        repo: "re-cinq/lore",
        commit: "abc123",
        branch: "main",
        tests: [{ id: "t1", name: "adds", file: "a.test.ts" }],
        results: [{ id: "t1", passed: true }],
      }),
    );

    expect(res.statusCode).toBe(202);
    expect(res.result).toEqual({ ingested: 1 });
    expect(vi.mocked(insertEventList).mock.calls[0]).toEqual([
      [
        {
          eventName: "internal.ingest.spec_trace",
          source: "internal",
          params: {
            repo: "re-cinq/lore",
            kind: "test-report",
            payload: {
              commit: "abc123",
              branch: "main",
              tests: [{ id: "t1", name: "adds", file: "a.test.ts" }],
              results: [{ id: "t1", passed: true }],
            },
          },
        },
      ],
      "ci-tests",
    ]);
  });

  it("keeps the posted report as the branch's latest, keyed by test id", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const testReports = new InMemoryTestReports();

    await authed(
      JSON.stringify({
        repo: "re-cinq/lore",
        commit: "abc123",
        branch: "lore/ticket-7",
        tests: [
          {
            id: "a.test.ts::adds",
            name: "adds",
            file: "a.test.ts",
            startLine: 4,
            endLine: 9,
            suite: ["math"],
          },
        ],
        results: [{ id: "a.test.ts::adds", passed: false }],
      }),
      testReports,
    );

    expect(
      await testReports.latestForBranch("re-cinq/lore", "lore/ticket-7"),
    ).toMatchObject({
      commit: "abc123",
      tests: [
        {
          id: "a.test.ts::adds",
          name: "adds",
          file: "a.test.ts",
          startLine: 4,
          suite: ["math"],
        },
      ],
      outcomes: { "a.test.ts::adds": false },
    });
  });

  it("stores no report for a body that names no branch", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const testReports = new InMemoryTestReports();
    const res = await authed(
      JSON.stringify({ repo: "re-cinq/lore", commit: "abc123" }),
      testReports,
    );

    expect(res.statusCode).toBe(202);
    expect(testReports.rows).toEqual([]);
  });

  it("returns 503 when the ingest token is not configured", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/ci-tests",
      headers: { authorization: "Bearer whatever" },
      payload: "{}",
    });

    expect(res.statusCode).toBe(503);
  });

  it("returns 401 when the bearer token is wrong", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/ci-tests",
      headers: { authorization: "Bearer wrong-token" },
      payload: "{}",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 on a malformed JSON body when authorized", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const res = await authed("{ not valid json");

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with the mapper message on a valid JSON body that fails validation", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const res = await authed(JSON.stringify({ repo: "re-cinq/lore" }));

    expect(res.statusCode).toBe(400);
    expect(res.result).toMatchObject({ error: "missing commit" });
  });

  it("returns 500 when the event insert fails (so the sender redelivers)", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    vi.mocked(insertEventList).mockRejectedValueOnce(new Error("db down"));
    const res = await authed(
      JSON.stringify({ repo: "re-cinq/lore", commit: "abc123" }),
    );

    expect(res.statusCode).toBe(500);
  });

  it("routes a feat/x report into the feat/x overlay when the default branch is main", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";

    await authed(
      JSON.stringify({
        repo: "re-cinq/lore",
        commit: "abc123",
        branch: "feat/x",
      }),
    );

    expect(vi.mocked(insertEventList).mock.calls[0][0]).toMatchObject([
      { params: { payload: { branch: "feat/x", overlayBranch: "feat/x" } } },
    ]);
  });
});
