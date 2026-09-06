import { describe, it, expect } from "vitest";
import { buildServer } from "../server.js";

describe("GET /healthz", () => {
  it("returns 503 with a database-error body when no pool is reachable", async () => {
    const res = await buildServer({
      getJobStatus: () => ({ scheduler: "ok" }),
    }).inject({
      method: "GET",
      url: "/healthz",
    });

    expect(res.statusCode).toBe(503);
    expect(res.result).toMatchObject({
      status: "error",
      reason: "database connection failed",
    });
  });
});
