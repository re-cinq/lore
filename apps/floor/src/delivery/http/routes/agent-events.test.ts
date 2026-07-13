import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "../server.js";

const ORIG = process.env.LORE_AGENT_INTERNAL_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_AGENT_INTERNAL_TOKEN;
  } else {
    process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG;
  }
});

describe("POST /api/agent-events", () => {
  it("returns 401 when the bearer token does not match", async () => {
    process.env.LORE_AGENT_INTERNAL_TOKEN = "internal-secret";
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/agent-events",
      headers: { authorization: "Bearer wrong" },
      payload: "{}",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when the internal token is not configured", async () => {
    delete process.env.LORE_AGENT_INTERNAL_TOKEN;
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/agent-events",
      headers: { authorization: "Bearer anything" },
      payload: "{}",
    });

    expect(res.statusCode).toBe(401);
  });
});
