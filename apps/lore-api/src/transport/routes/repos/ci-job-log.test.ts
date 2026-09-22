import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const LOG = [
  "2026-09-09T13:06:58.3Z specs/x/spec.md",
  "2026-09-09T13:06:58.4Z ##[error]  7:1  error  Status draft",
  "2026-09-09T13:06:58.6Z ##[error]Process completed with exit code 1.",
].join("\n");

const githubError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

const GITHUB_ERRORS: Record<number, Error> = {
  9: githubError(403, "Resource not accessible by integration"),
  10: githubError(429, "API rate limit exceeded"),
};

const fakePulls = {
  jobLog: async (jobId: number) => {
    if (GITHUB_ERRORS[jobId]) {
      throw GITHUB_ERRORS[jobId];
    }

    return jobId === 7 ? LOG : null;
  },
};

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async () => ({ pulls: fakePulls }),
}));

import { buildServer } from "../../../app/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (url: string) =>
  buildServer(() => null).inject({ method: "GET", url, headers: AUTH });

describe("GET /api/repos/{owner}/{repo}/ci-jobs/{job_id}/log", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the job's log tail without timestamps, 200 lines by default", async () => {
    const res = await get("/api/repos/re-cinq/lore/ci-jobs/7/log");

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 200,
      body: {
        job_id: 7,
        lines: [
          "specs/x/spec.md",
          "##[error]  7:1  error  Status draft",
          "##[error]Process completed with exit code 1.",
        ],
        total: 3,
        truncated: false,
      },
    });
  });

  it("filters by grep and bounds by tail", async () => {
    const res = await get(
      "/api/repos/re-cinq/lore/ci-jobs/7/log?grep=error&tail=1",
    );

    expect(res.result).toEqual({
      job_id: 7,
      lines: ["##[error]Process completed with exit code 1."],
      total: 2,
      truncated: true,
    });
  });

  it("returns 404 when GitHub will not show the job", async () => {
    expect(
      (await get("/api/repos/re-cinq/lore/ci-jobs/8/log")).statusCode,
    ).toBe(404);
  });

  it("returns 424 carrying GitHub's 403 and its own words when GitHub refuses the log read, a status the MCP proxy passes through with its body", async () => {
    const res = await get("/api/repos/re-cinq/lore/ci-jobs/9/log");

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 424,
      body: {
        error:
          "GitHub would not serve the job log (403): Resource not accessible by integration — a 403 naming the integration means the GitHub App lacks Actions read permission on this repository",
      },
    });
  });

  it("returns 424 carrying GitHub's 429 without the permission hint when GitHub rate-limits the log read", async () => {
    const res = await get("/api/repos/re-cinq/lore/ci-jobs/10/log");

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 424,
      body: {
        error:
          "GitHub would not serve the job log (429): API rate limit exceeded",
      },
    });
  });

  it("returns 400 for a tail past 2000 lines", async () => {
    expect(
      (await get("/api/repos/re-cinq/lore/ci-jobs/7/log?tail=5000")).statusCode,
    ).toBe(400);
  });
});
