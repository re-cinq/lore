import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CheckRun } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

const GITHUB_ANSWERS: Record<string, () => CheckRun[]> = {
  "gone-branch": () => {
    throw Object.assign(new Error("Not Found"), { status: 404 });
  },
  unconfigured: () => {
    throw new Error(
      "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
    );
  },
};

const fakePulls = {
  get: async (number: number) => (number === 5 ? { branch: "topic" } : null),
  listBranchCommits: async (branch: string) => {
    GITHUB_ANSWERS[branch]?.();

    return [{ sha: "deadbeef", message: "feat: x", date: "t" }];
  },
  listChecks: async (): Promise<CheckRun[]> => [
    {
      id: 1,
      app: "github-actions",
      name: "format",
      status: "completed",
      conclusion: "failure",
      output: { title: null, summary: null },
    },
  ],
  failedJob: async () => ({
    annotations: ["specs/x/spec.md:7 Status draft"],
    steps: ["Lint"],
    tail: ["✖ 1 problem"],
  }),
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

const REPORT = {
  branch: "topic",
  judged_sha: "deadbeef",
  conclusion: "failure",
  failures: [
    {
      name: "format",
      app: "github-actions",
      job_id: 1,
      annotations: ["specs/x/spec.md:7 Status draft"],
      steps: ["Lint"],
      tail: ["✖ 1 problem"],
    },
  ],
};

describe("GET /api/repos/{owner}/{repo}/ci-failures", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports the branch's failed checks by branch name", async () => {
    const res = await get("/api/repos/re-cinq/lore/ci-failures?branch=topic");

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 200,
      body: REPORT,
    });
  });

  it("reports the same by pull request number, resolved to its head branch", async () => {
    const res = await get("/api/repos/re-cinq/lore/ci-failures?pr_number=5");

    expect(res.result).toEqual(REPORT);
  });

  it("returns 400 when neither branch nor pr_number is given", async () => {
    expect((await get("/api/repos/re-cinq/lore/ci-failures")).statusCode).toBe(
      400,
    );
  });

  it("returns 404 for a pull request GitHub does not have", async () => {
    expect(
      (await get("/api/repos/re-cinq/lore/ci-failures?pr_number=9")).statusCode,
    ).toBe(404);
  });

  it("returns 404 for a branch GitHub does not have", async () => {
    expect(
      (await get("/api/repos/re-cinq/lore/ci-failures?branch=gone-branch"))
        .statusCode,
    ).toBe(404);
  });

  it("returns 424 when GitHub is not configured", async () => {
    expect(
      (await get("/api/repos/re-cinq/lore/ci-failures?branch=unconfigured"))
        .statusCode,
    ).toBe(424);
  });
});
