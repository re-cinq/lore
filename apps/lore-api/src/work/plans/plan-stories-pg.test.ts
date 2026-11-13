import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { pgPlanStories } from "./plan-stories-pg.js";

function dbAnswering(rows: object[]) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const db = () =>
    ({
      query: async (text: string, params: unknown[]) => {
        queries.push({ text, params });

        return { rows };
      },
    }) as unknown as Pool;

  return { db, queries };
}

describe("pgPlanStories", () => {
  it("reads story 12 saved on plan p1", async () => {
    const { db, queries } = dbAnswering([{ issueNumber: 12 }]);

    const saved = await pgPlanStories(db).saved("p1");

    expect({ saved, params: queries.map((query) => query.params) }).toEqual({
      saved: { issueNumber: 12 },
      params: [["p1"]],
    });
  });

  it("reads a removed story on plan p1 as null, not as never saved", async () => {
    const { db } = dbAnswering([{ issueNumber: null }]);

    expect(await pgPlanStories(db).saved("p1")).toEqual({ issueNumber: null });
  });

  it("reads nothing for plan p1 when no row was saved", async () => {
    const { db } = dbAnswering([]);

    expect(await pgPlanStories(db).saved("p1")).toBeUndefined();
  });

  it("upserts story 12 on plan p1 set by ana", async () => {
    const { db, queries } = dbAnswering([]);

    await pgPlanStories(db).save({
      planId: "p1",
      issueNumber: 12,
      setBy: "ana",
    });

    expect(queries).toMatchObject([
      {
        text: expect.stringContaining("ON CONFLICT (plan_id) DO UPDATE"),
        params: ["p1", 12, "ana"],
      },
    ]);
  });
});
