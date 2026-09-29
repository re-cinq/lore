import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const calls: string[] = [];

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async (repo: string) => ({
    issues: {
      addSubIssue: async (parent: number, child: number) => {
        calls.push(`sub:${repo}:${parent}:${child}`);
      },
      updateBody: async (number: number, body: string) => {
        calls.push(`body:${repo}:${number}:${body}`);
      },
    },
  }),
}));

import { buildServer } from "../../../app/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const send = (method: "POST" | "PATCH", url: string, payload: object) =>
  buildServer(() => null).inject({ method, url, headers: AUTH, payload });

describe("station issue links", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    calls.length = 0;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("makes #2261 a sub-issue of #2260 in re-cinq/lore", async () => {
    const res = await send(
      "POST",
      "/api/repos/re-cinq/lore/issues/2260/sub-issues",
      { child: 2261 },
    );

    expect({ status: res.statusCode, calls }).toEqual({
      status: 200,
      calls: ["sub:re-cinq/lore:2260:2261"],
    });
  });

  it("rewrites #2260's body in re-cinq/lore", async () => {
    const res = await send("PATCH", "/api/repos/re-cinq/lore/issues/2260", {
      body: "- [ ] #2261 T001",
    });

    expect({ status: res.statusCode, calls }).toEqual({
      status: 200,
      calls: ["body:re-cinq/lore:2260:- [ ] #2261 T001"],
    });
  });

  it("answers 400 for a sub-issue link with no child", async () => {
    const res = await send(
      "POST",
      "/api/repos/re-cinq/lore/issues/2260/sub-issues",
      {},
    );

    expect({ status: res.statusCode, calls }).toEqual({
      status: 400,
      calls: [],
    });
  });
});
