import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PullFileChange } from "@re-cinq/lore-shared";

const FILES: PullFileChange[] = [
  {
    filename: "src/a.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: "@@ -1,2 +1,3 @@\n-a\n+b\n+c\n d",
  },
  {
    filename: "logo.png",
    status: "added",
    additions: 0,
    deletions: 0,
    patch: null,
  },
];

const GITHUB_ANSWERS: Record<number, () => PullFileChange[]> = {
  404: () => {
    throw Object.assign(new Error("Not Found"), { status: 404 });
  },
  424: () => {
    throw new Error(
      "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
    );
  },
};

const fakePulls = {
  listFileChanges: async (number: number): Promise<PullFileChange[]> =>
    (GITHUB_ANSWERS[number] ?? (() => FILES))(),
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
const get = (number: string, headers: Record<string, string> = AUTH) =>
  buildServer(() => null).inject({
    method: "GET",
    url: `/api/repos/re-cinq/lore/pulls/${number}/files`,
    headers,
  });

describe("GET /api/repos/{owner}/{repo}/pulls/{number}/files", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 without a bearer token", async () => {
    const res = await get("7", {});

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when number is not a positive integer", async () => {
    expect((await get("abc")).statusCode).toBe(400);
    expect((await get("0")).statusCode).toBe(400);
  });

  it("returns every changed file with status, counts and patch", async () => {
    const res = await get("7");

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ files: FILES });
  });

  it("returns 404 when GitHub has no such pull request", async () => {
    const res = await get("404");

    expect(res.statusCode).toBe(404);
    expect(res.result).toEqual({ error: "pull request not found" });
  });

  it("returns 424 when GitHub is not configured", async () => {
    const res = await get("424");

    expect(res.statusCode).toBe(424);
  });
});
