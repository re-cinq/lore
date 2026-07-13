import { describe, it, expect, afterEach, vi } from "vitest";
import { buildServer } from "../server.js";
import { insertEventList } from "../../../main-loop/store.js";

vi.mock("../../../main-loop/store.js", () => ({ insertEventList: vi.fn() }));

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;
  } else {
    process.env.LORE_INGEST_TOKEN = ORIG;
  }
  vi.mocked(insertEventList).mockReset();
});

const authed = (payload: string) =>
  buildServer({ getJobStatus: () => ({}) }).inject({
    method: "POST",
    url: "/api/webhook/ci-tests",
    headers: { authorization: "Bearer right-token" },
    payload,
  });

describe("POST /api/webhook/ci-tests", () => {
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
    const res = await authed(JSON.stringify({ repo: "re-cinq/lore" })); // missing commit

    expect(res.statusCode).toBe(400);
    expect(res.result).toMatchObject({ message: "missing commit" });
  });

  it("returns 500 when the event insert fails (so the sender redelivers)", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    vi.mocked(insertEventList).mockRejectedValueOnce(new Error("db down"));
    const res = await authed(
      JSON.stringify({ repo: "re-cinq/lore", commit: "abc123" }),
    );

    expect(res.statusCode).toBe(500);
  });
});
