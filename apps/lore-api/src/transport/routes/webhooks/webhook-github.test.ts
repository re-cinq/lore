import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { buildServer } from "../../../app/build-server.js";
import { useRateLimitSafeClock } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const SECRET = "hook-secret";
const originalEnv = { ...process.env };

interface Statement {
  sql: string;
  params: unknown[];
}

function recordingPool(): { statements: Statement[]; pool: Pool } {
  const statements: Statement[] = [];
  const pool = {
    query: (sql: unknown, params: unknown[] = []) => {
      statements.push({ sql: String(sql), params });

      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;

  return { statements, pool };
}

function signed(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

function deliver(
  body: string,
  headers: Record<string, string>,
  pool: Pool = recordingPool().pool,
) {
  return buildServer(() => pool).inject({
    method: "POST",
    url: "/api/webhook/github",
    headers,
    payload: body,
  });
}

function closedPullRequest(padding = ""): string {
  return JSON.stringify({
    action: "closed",
    pull_request: { number: 7, merged: true },
    repository: { full_name: "re-cinq/lore" },
    padding,
  });
}

function eventInserts(statements: Statement[]): unknown[][] {
  return statements
    .filter(({ sql }) => sql.includes("INSERT INTO pipeline.events"))
    .map(({ params }) => params);
}

describe("POST /api/webhook/github", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("answers 202 and writes github.pull_request.closed deduped on github:d-1 for signed delivery d-1", async () => {
    const { statements, pool } = recordingPool();
    const body = closedPullRequest();

    const res = await deliver(
      body,
      {
        "x-hub-signature-256": signed(body),
        "x-github-event": "pull_request",
        "x-github-delivery": "d-1",
      },
      pool,
    );

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 202,
      body: { captured: 1, events: ["github.pull_request.closed"] },
    });
    expect(eventInserts(statements)).toEqual([
      expect.arrayContaining(["github.pull_request.closed", "github:d-1"]),
    ]);
  });

  it("answers 401 naming the signature header for a delivery that carries no signature and no bearer token", async () => {
    const res = await deliver(closedPullRequest(), {
      "x-github-event": "pull_request",
    });

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 401,
      body: { error: "missing x-hub-signature-256 header" },
    });
  });

  it("answers 401 and writes nothing for a signature that does not match the secret", async () => {
    const { statements, pool } = recordingPool();

    const res = await deliver(
      closedPullRequest(),
      {
        "x-hub-signature-256": "sha256=" + "0".repeat(64),
        "x-github-event": "pull_request",
      },
      pool,
    );

    expect({
      status: res.statusCode,
      inserts: eventInserts(statements),
    }).toEqual({ status: 401, inserts: [] });
  });

  it("answers 202 for a signed delivery of 2 MB, over the 1 MB JSON limit of the other routes", async () => {
    const body = closedPullRequest("x".repeat(2 * 1024 * 1024));

    const res = await deliver(body, {
      "x-hub-signature-256": signed(body),
      "x-github-event": "pull_request",
      "x-github-delivery": "d-big",
    });

    expect(res.statusCode).toBe(202);
  });

  it("answers 202 to the 31st delivery within a minute, past the 30 a minute of the other webhooks", async () => {
    const body = JSON.stringify({ zen: "Keep it simple" });
    const headers = {
      "x-hub-signature-256": signed(body),
      "x-github-event": "ping",
    };
    const { pool } = recordingPool();
    const statuses: number[] = [];

    for (let delivery = 1; delivery <= 31; delivery++) {
      statuses.push((await deliver(body, headers, pool)).statusCode);
    }

    expect(statuses).toEqual(Array.from({ length: 31 }, () => 202));
  });

  it("answers 400 for a signed body that is not JSON", async () => {
    const body = "not json";

    const res = await deliver(body, {
      "x-hub-signature-256": signed(body),
      "x-github-event": "pull_request",
    });

    expect(res.statusCode).toBe(400);
  });
});
