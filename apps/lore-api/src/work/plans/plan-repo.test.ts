import { describe, it, expect } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { planRepoOf } from "./plan-repo.js";

const PLAN = "11111111-2222-4333-8444-555555555555";

describe("planRepoOf", () => {
  it("reads the repository of the plan with that id", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ repo: "re-cinq/lore" }] });

    expect({
      repo: await planRepoOf(pool as never, PLAN),
      params: pool.query.mock.calls[0][1],
    }).toEqual({ repo: "re-cinq/lore", params: [PLAN] });
  });

  it("answers null for an id no plan has", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });

    expect(await planRepoOf(pool as never, PLAN)).toBeNull();
  });

  it("answers null without asking the database for an id that cannot be a plan's", async () => {
    const pool = makePool();

    expect({
      repo: await planRepoOf(pool as never, "not-a-plan"),
      queries: pool.query.mock.calls.length,
    }).toEqual({ repo: null, queries: 0 });
  });
});
