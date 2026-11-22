import { describe, it, expect } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { resolvePrincipal } from "./auth.js";

describe("resolvePrincipal for a stored ci token", () => {
  it("resolves to the one repository its numeric id names, whatever its name", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            scopes: [],
            kind: "ci",
            githubRepoId: "1001",
            startedAt: new Date("2026-10-28T10:00:00Z"),
            expiresAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ full_name: "acme/renamed", default_branch: "develop" }],
      });

    expect(
      (await resolvePrincipal(pool as never, "ci-token"))?.ciIdentity,
    ).toEqual({
      repository: "acme/renamed",
      ref: "",
      defaultBranch: "develop",
      stored: true,
    });
  });
});
