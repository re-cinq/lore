import Hapi from "@hapi/hapi";
import { describe, it, expect } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { decideLlmStatus, llmStatusRoute } from "./llm-status.js";

const AT = new Date("2026-08-20T09:14:00Z");

describe("decideLlmStatus", () => {
  it("reports healthy when nothing recent failed on the account", () => {
    expect(decideLlmStatus([])).toEqual({
      degraded: false,
      failure_class: null,
      detail: null,
      since: null,
      affected_runs: 0,
    });
  });

  it("reports the outage, its cause, and how many runs it has eaten", () => {
    expect(
      decideLlmStatus([
        {
          failure_class: "anthropic-credit",
          failure_detail: "Credit balance is too low",
          oldest: AT,
          runs: 12,
        },
      ]),
    ).toEqual({
      degraded: true,
      failure_class: "anthropic-credit",
      detail: "Credit balance is too low",
      since: AT,
      affected_runs: 12,
    });
  });

  it("ignores failures that are one run's problem rather than the account's", () => {
    expect(
      decideLlmStatus([
        {
          failure_class: "infra",
          failure_detail: "pod OOMKilled",
          oldest: AT,
          runs: 40,
        },
      ]).degraded,
    ).toEqual(false);
  });

  it("reports the account-wide class even when local failures outnumber it", () => {
    expect(
      decideLlmStatus([
        {
          failure_class: "infra",
          failure_detail: "pod OOMKilled",
          oldest: AT,
          runs: 40,
        },
        {
          failure_class: "anthropic-credit",
          failure_detail: "Credit balance is too low",
          oldest: AT,
          runs: 2,
        },
      ]),
    ).toMatchObject({ degraded: true, failure_class: "anthropic-credit" });
  });

  it("survives a row whose detail was never recorded", () => {
    expect(
      decideLlmStatus([
        {
          failure_class: "anthropic-credit",
          failure_detail: null,
          oldest: AT,
          runs: 1,
        },
      ]),
    ).toMatchObject({ degraded: true, detail: null });
  });
});

describe("GET /api/platform/llm-status", () => {
  async function serve(pool: ReturnType<typeof makePool> | null) {
    const server = Hapi.server();

    server.auth.scheme("stub", () => ({
      authenticate: (_r, h) => h.authenticated({ credentials: {} }),
    }));
    server.auth.strategy("bearer-scope", "stub");
    server.auth.default("bearer-scope");
    server.route(llmStatusRoute(() => pool as never));

    return server;
  }

  it("answers healthy on a database that predates the failure columns", async () => {
    // Every sibling run read degrades to empty on a pre-migration database. This
    // one is polled by a BANNER, so a 500 here is the outage-reporting machinery
    // reporting itself rather than the outage.
    const pool = makePool();

    pool.query.mockRejectedValue(
      Object.assign(new Error('column "failure_class" does not exist'), {
        code: "42703",
      }),
    );

    const res = await (await serve(pool)).inject("/api/platform/llm-status");

    expect(res.statusCode).toEqual(200);
    expect(JSON.parse(res.payload)).toMatchObject({ degraded: false });
  });

  it("propagates a failure that is not a missing column", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(
      Object.assign(new Error("connection terminated"), { code: "57P01" }),
    );

    const res = await (await serve(pool)).inject("/api/platform/llm-status");

    expect(res.statusCode).toEqual(500);
  });

  it("answers 503 without a pool", async () => {
    const res = await (await serve(null)).inject("/api/platform/llm-status");

    expect(res.statusCode).toEqual(503);
  });
});
