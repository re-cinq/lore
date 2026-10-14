import { describe, it, expect } from "vitest";
import {
  prunePrBlockedReasons,
  PR_BLOCKED_REASONS_RETENTION_DAYS,
} from "./pr-blocked-reasons-retention.js";
import type { PgPool } from "../../domain/memory-store-types.js";

function poolAnswering(count: number): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: [{ count }] as T[] };
    },
  };

  return { pool, calls };
}

describe("prunePrBlockedReasons", () => {
  it("deletes rows closed before the 30-day window and reports 2 removed", async () => {
    const { pool, calls } = poolAnswering(2);

    expect(await prunePrBlockedReasons(pool)).toBe(
      `pruned pr_blocked_reasons closed more than ${PR_BLOCKED_REASONS_RETENTION_DAYS}d ago — 2`,
    );
    expect(calls).toMatchObject([
      {
        text: expect.stringContaining(
          "closed_at < now() - make_interval(days => $1)",
        ),
        params: [30],
      },
    ]);
  });
});
