import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { IssueRef } from "@re-cinq/lore-shared";

const ISSUE: IssueRef = {
  repo: "re-cinq/lore",
  number: 7,
  title: "Show the issue on the run page",
  state: "open",
  labels: ["lore-managed"],
  url: "https://github.com/re-cinq/lore/issues/7",
  body: "## Why\nNo tab switch.",
};

const ISSUES: Record<number, IssueRef> = {
  7: ISSUE,
  8: { ...ISSUE, number: 8, body: undefined },
};

const UNCONFIGURED = 424;

async function getIssue(number: number): Promise<IssueRef | null> {
  enforceTrue(
    number !== UNCONFIGURED,
    Error,
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
  );

  return ISSUES[number] ?? null;
}

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async () => ({ issues: { get: getIssue } }),
}));

import { buildServer } from "../../../app/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (number: string, headers: Record<string, string> = AUTH) =>
  buildServer(() => null).inject({
    method: "GET",
    url: `/api/repos/re-cinq/lore/issues/${number}`,
    headers,
  });

describe("GET /api/repos/{owner}/{repo}/issues/{number}", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 without a bearer token", async () => {
    expect((await get("7", {})).statusCode).toBe(401);
  });

  it("returns 400 when number is not a positive integer", async () => {
    expect([
      (await get("abc")).statusCode,
      (await get("0")).statusCode,
    ]).toEqual([400, 400]);
  });

  it("returns the issue's number, title, state, url and body", async () => {
    const res = await get("7");

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 200,
      body: {
        number: 7,
        title: "Show the issue on the run page",
        state: "open",
        url: "https://github.com/re-cinq/lore/issues/7",
        body: "## Why\nNo tab switch.",
      },
    });
  });

  it("returns a null body for an issue opened with no description", async () => {
    expect((await get("8")).result).toMatchObject({ number: 8, body: null });
  });

  it("returns 404 for an issue GitHub does not know", async () => {
    expect((await get("99")).statusCode).toBe(404);
  });

  it("returns 424 when GitHub is not configured", async () => {
    expect((await get(String(UNCONFIGURED))).statusCode).toBe(424);
  });
});
