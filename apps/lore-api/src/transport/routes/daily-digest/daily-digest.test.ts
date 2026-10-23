import Hapi from "@hapi/hapi";
import { describe, it, expect } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { dailyDigestRoute } from "./daily-digest.js";

function serve(
  pool: unknown,
  runOfVisit: (visitId: string) => Promise<string | null> = async () => null,
) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(dailyDigestRoute(() => pool as never, runOfVisit));

  return server;
}

describe("GET /api/repos/{owner}/{repo}/daily-digest", () => {
  it("lists re-cinq/lore's post of 2026-10-22 under recent, linked to run-9, the run its posting visit-1 belongs to", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: "visit-1",
            status: "posted",
            posted_at: new Date("2026-10-22T07:00:00Z"),
          },
        ],
      });

    const res = await serve(pool, async (visitId) =>
      visitId === "visit-1" ? "run-9" : null,
    ).inject("/api/repos/re-cinq/lore/daily-digest");
    const posts = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("lore.digest_posts"),
    );

    expect({
      status: res.statusCode,
      repo: posts?.[1],
      recent: JSON.parse(res.payload).recent.map(
        (row: { ref: string; run_id: string | null }) => [row.ref, row.run_id],
      ),
    }).toEqual({
      status: 200,
      repo: ["re-cinq/lore"],
      recent: [["2026-10-22", "run-9"]],
    });
  });

  it("answers 404 for a repo with no row, reading no posts", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });

    const res = await serve(pool).inject(
      "/api/repos/re-cinq/lore/daily-digest",
    );

    expect({
      status: res.statusCode,
      reads: pool.query.mock.calls.length,
    }).toEqual({ status: 404, reads: 1 });
  });
});
