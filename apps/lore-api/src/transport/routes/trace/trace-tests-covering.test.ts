import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  useRateLimitSafeClock,
  makePool,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const base = "/api/repos/o/r/trace/tests-covering";

const get = (url: string) =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

function fakeTrace(tests: unknown[] = []) {
  const testsCovering = vi.fn().mockResolvedValue(tests);

  vi.mocked(projectFor).mockResolvedValue({
    trace: { testsCovering },
  } as never);

  return testsCovering;
}

describe("GET /api/repos/:owner/:repo/trace/tests-covering", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 400 when no path names the covered file", async () => {
    fakeTrace();
    const res = await get(base);

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "path query param required" });
  });

  it("returns the port's covering tests under a tests key", async () => {
    fakeTrace([
      { testFile: "src/a.test.ts", statement: "does a", origin: "main" },
    ]);
    const res = await get(`${base}?path=src/a.ts`);

    expect(res.result).toEqual({
      tests: [
        { testFile: "src/a.test.ts", statement: "does a", origin: "main" },
      ],
    });
  });

  it("passes parsed ranges and the branch to the port", async () => {
    const testsCovering = fakeTrace();

    await get(`${base}?path=src/a.ts&ranges=10-20,30-40&branch=feat%2Fx`);

    expect(testsCovering).toHaveBeenCalledWith(
      {
        file: "src/a.ts",
        ranges: [
          [10, 20],
          [30, 40],
        ],
      },
      "feat/x",
    );
  });

  it("omits ranges from the target when the query names none", async () => {
    const testsCovering = fakeTrace();

    await get(`${base}?path=src/a.ts`);

    expect(testsCovering).toHaveBeenCalledWith({ file: "src/a.ts" }, undefined);
  });

  it("returns 400 when the ranges query exceeds the length bound", async () => {
    fakeTrace();
    const res = await get(`${base}?path=src/a.ts&ranges=${"1".repeat(201)}`);

    expect(res.statusCode).toBe(400);
  });
});
