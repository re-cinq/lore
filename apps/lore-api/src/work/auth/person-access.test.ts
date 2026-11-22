import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { lockPerson } from "./person-access.js";

function recordingPool() {
  const query = vi.fn().mockResolvedValue({ rows: [] });

  return { query, pool: { query } as unknown as Pool };
}

describe("lockPerson", () => {
  it("takes a transaction-scoped advisory lock keyed by the GitHub numeric id", async () => {
    const { query, pool } = recordingPool();

    await lockPerson(pool, 4242);

    expect(query.mock.calls).toEqual([
      [expect.stringContaining("pg_advisory_xact_lock($1::bigint)"), [4242]],
    ]);
  });
});
