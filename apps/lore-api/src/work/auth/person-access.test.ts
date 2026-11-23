import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import {
  enforceSessionCurrent,
  generationOf,
  lockPerson,
  revokePersonAccess,
} from "./person-access.js";

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

function transactionalPool(revokedRows: Array<{ id: string }> = []) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql: sql.trim(), params });

      return { rows: sql.includes("RETURNING id") ? revokedRows : [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

  return { pool, statements };
}

describe("generationOf", () => {
  it("answers 0 for a person with no row", async () => {
    const { query, pool } = recordingPool();

    expect(await generationOf(pool, 4242)).toBe(0);
    expect(query.mock.calls).toEqual([
      [
        expect.stringContaining(
          "FROM pipeline.person_generations WHERE github_id = $1",
        ),
        [4242],
      ],
    ]);
  });

  it("answers the integer stored for a person with a row", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ generation: 3 }] });

    expect(await generationOf({ query } as unknown as Pool, 4242)).toBe(3);
  });
});

describe("revokePersonAccess", () => {
  it("takes the person's lock, adds one to their generation and revokes every token and session of theirs in one transaction", async () => {
    const { pool, statements } = transactionalPool();

    await revokePersonAccess(pool, 4242);

    expect(statements).toEqual([
      { sql: "BEGIN", params: [] },
      { sql: expect.stringContaining("pg_advisory_xact_lock"), params: [4242] },
      {
        sql: expect.stringMatching(
          /INSERT INTO pipeline\.person_generations[\s\S]*ON CONFLICT \(github_id\) DO UPDATE SET generation = pipeline\.person_generations\.generation \+ 1/,
        ),
        params: [4242],
      },
      {
        sql: expect.stringMatching(
          /UPDATE pipeline\.api_tokens SET revoked_at = now\(\)\s+WHERE github_id = \$1 AND revoked_at IS NULL/,
        ),
        params: [4242],
      },
      { sql: "COMMIT", params: [] },
    ]);
  });

  it("answers the count of sessions and tokens it ended, including 0 when none were open", async () => {
    const empty = transactionalPool();
    const two = transactionalPool([{ id: "row-1" }, { id: "row-2" }]);

    expect({
      none: await revokePersonAccess(empty.pool, 4242),
      two: await revokePersonAccess(two.pool, 4242),
    }).toEqual({ none: 0, two: 2 });
  });
});

describe("enforceSessionCurrent", () => {
  const NOW = new Date("2026-11-22T10:00:00Z");
  const HOUR_MS = 60 * 60 * 1000;

  function sessionPool(
    session: Record<string, unknown> | null,
    personGeneration: number,
  ) {
    const sessionRows = session ? [session] : [];
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes("person_generations")
        ? [{ generation: personGeneration }]
        : sessionRows,
    }));

    return { query, pool: { query } as unknown as Pool };
  }

  const open = {
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + HOUR_MS),
    generation: 2,
  };

  async function outcomeOf(
    session: Record<string, unknown> | null,
    personGeneration: number,
  ) {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { pool } = sessionPool(session, personGeneration);

    try {
      await enforceSessionCurrent(pool, "hash-1", 4242);

      return "kept";
    } catch (err) {
      return (err as { output?: { statusCode: number } }).output?.statusCode;
    } finally {
      vi.useRealTimers();
    }
  }

  it("keeps a session that is open and carries the person's generation 2", async () => {
    expect(await outcomeOf(open, 2)).toBe("kept");
  });

  it("refuses with 401 a session whose revoked_at is set", async () => {
    expect(await outcomeOf({ ...open, revokedAt: NOW }, 2)).toBe(401);
  });

  it("refuses with 401 a session whose expiry has passed", async () => {
    expect(
      await outcomeOf({ ...open, expiresAt: new Date(NOW.getTime() - 1) }, 2),
    ).toBe(401);
  });

  it("refuses with 401 a session with generation 2 when the person's generation is 3", async () => {
    expect(await outcomeOf(open, 3)).toBe(401);
  });

  it("refuses with 401 a session that records no generation", async () => {
    expect(await outcomeOf({ ...open, generation: null }, 0)).toBe(401);
  });

  it("refuses with 401 a session whose row is gone", async () => {
    expect(await outcomeOf(null, 0)).toBe(401);
  });
});
