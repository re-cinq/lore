import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "../server.js";

const ORIG = process.env.LORE_INGEST_TOKEN;
afterEach(() => {
  if (ORIG === undefined) delete process.env.LORE_INGEST_TOKEN;
  else process.env.LORE_INGEST_TOKEN = ORIG;
});

describe("POST /api/webhook/ci-ingest", () => {
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
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/ci-ingest",
      headers: { authorization: "Bearer right-token" },
      payload: "{ not valid json",
    });
    expect(res.statusCode).toBe(400);
  });
});
