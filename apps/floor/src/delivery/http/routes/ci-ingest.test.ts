import { describe, it, expect, afterEach, vi } from "vitest";
import { buildServer } from "../server.js";
import { insertEventList } from "../../../kernel/event-store.js";

vi.mock("../../../kernel/event-store.js", () => ({ insertEventList: vi.fn() }));

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  vi.mocked(insertEventList).mockReset();

  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;

    return;
  }
  process.env.LORE_INGEST_TOKEN = ORIG;
});

const authed = (payload: string) =>
  buildServer({ getJobStatus: () => ({}) }).inject({
    method: "POST",
    url: "/api/webhook/ci-ingest",
    headers: { authorization: "Bearer right-token" },
    payload,
  });

describe("POST /api/webhook/ci-ingest", () => {
  it("returns 202 and queues one spec_trace event per requested kind, asserting the actual insert since CI never retries a 2xx", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const res = await authed(
      JSON.stringify({
        repo: "re-cinq/lore",
        kinds: ["specs", "adrs"],
        commit: "abc123",
        force: true,
      }),
    );

    expect(res.statusCode).toBe(202);
    expect(res.result).toEqual({ triggered: ["specs", "adrs"] });
    expect(vi.mocked(insertEventList).mock.calls[0]).toEqual([
      [
        {
          eventName: "internal.ingest.spec_trace",
          source: "internal",
          params: {
            repo: "re-cinq/lore",
            kind: "specs",
            payload: { commit: "abc123", force: true },
          },
        },
        {
          eventName: "internal.ingest.spec_trace",
          source: "internal",
          params: {
            repo: "re-cinq/lore",
            kind: "adrs",
            payload: { commit: "abc123", force: true },
          },
        },
      ],
      "ci-ingest",
    ]);
  });

  it("projects every doc kind when the body names none", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const res = await authed(
      JSON.stringify({ repo: "re-cinq/lore", commit: "abc123" }),
    );

    expect(res.statusCode).toBe(202);
    expect(res.result).toEqual({ triggered: ["specs", "adrs"] });
  });

  it("returns 503 when the ingest token is not configured", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/ci-ingest",
      headers: { authorization: "Bearer whatever" },
      payload: "{}",
    });

    expect(res.statusCode).toBe(503);
  });

  it("returns 401 when the bearer token is wrong", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/ci-ingest",
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
    const res = await authed(
      JSON.stringify({ repo: "re-cinq/lore", kinds: ["bogus"] }),
    );

    expect(res.statusCode).toBe(400);
    expect((res.result as { error?: string }).error).toContain(
      "unsupported kind(s): bogus",
    );
  });

  it("returns 500 when the event insert fails (so the sender redelivers)", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    vi.mocked(insertEventList).mockRejectedValueOnce(new Error("db down"));
    const res = await authed(
      JSON.stringify({
        repo: "re-cinq/lore",
        kinds: ["specs"],
        commit: "abc123",
      }),
    );

    expect(res.statusCode).toBe(500);
  });
});
