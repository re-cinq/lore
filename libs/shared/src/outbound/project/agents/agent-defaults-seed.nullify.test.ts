import { describe, it, expect } from "vitest";
import { seedAgentDefaults } from "./agent-defaults-seed.js";
import type { PgPool } from "../../../domain/memory-store-types.js";

describe("seedAgentDefaults – nullify duplicate project fields", () => {
  it("nullifies a project row's prompt when it matches the org row on boot", async () => {
    const sqls: string[] = [];
    const mockPool: Pick<PgPool, "query"> = {
      async query(sql: string, _params?: unknown[]) {
        sqls.push(sql);
        return { rows: [], rowCount: 0 } as any;
      },
    };

    // Can be called with no defaults; returns an empty seed result
    const result = await seedAgentDefaults(mockPool as PgPool);

    expect(result).toMatchObject({ inserted: [], updated: [], diverged: [] });
    // The nullification UPDATE must have run
    expect(sqls.some((s) => s.includes("project_id IS NOT NULL"))).toBe(true);
  });
});
