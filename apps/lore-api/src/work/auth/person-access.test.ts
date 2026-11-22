import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import {
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

function transactionalPool(generationRows: Array<{ generation: number }> = []) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql: sql.trim(), params });

      return { rows: sql.includes("SELECT generation") ? generationRows : [] };
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
});
