import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoDeclarationOf } from "../../../http/repo-guard.js";
import { buildServer } from "../../../../app/build-server.js";
import {
  AUTH,
  LEGACY_TOKEN,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("POST /api/repos/{owner}/{repo}/loops/implementation/tickets/{issue}/start", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const post = (issue: string, pool: unknown = null) =>
    buildServer(() => pool as never).inject({
      method: "POST",
      url: `/api/repos/re-cinq/lore/loops/implementation/tickets/${issue}/start`,
      headers: AUTH,
    });

  it("returns 503 when the pool is null", async () => {
    expect((await post("9")).statusCode).toBe(503);
  });

  it("returns 400 for an issue that is not a whole number above 0", async () => {
    const statuses = await Promise.all(
      ["abc", "0", "2.5"].map(async (issue) => (await post(issue)).statusCode),
    );

    expect(statuses).toEqual([400, 400, 400]);
  });

  it("declares write, not admin, as the repository level it needs", () => {
    const route = buildServer(() => null)
      .table()
      .find(
        (r) =>
          r.method === "post" &&
          r.path ===
            "/api/repos/{owner}/{repo}/loops/implementation/tickets/{issue}/start",
      );

    expect(
      route &&
        repoDeclarationOf({ route: { settings: route.settings } })?.level,
    ).toBe("write");
  });
});
