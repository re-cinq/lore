/** Statements that must land together run on one checked-out client; `hasConnect` feature-detects connect(), and a pool without it (a test double) keeps the plain sequential path. */

import { hasConnect } from "../../domain/memory-store-types.js";
import type { PgPool } from "../../domain/memory-store-types.js";

export async function runInTransaction<T>(
  db: PgPool,
  work: (tx: Pick<PgPool, "query">) => Promise<T>,
): Promise<T> {
  if (!hasConnect(db)) {
    return work(db);
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await work(client);

    await client.query("COMMIT");

    return result;
  } catch (err) {
    // Best-effort: the connection may already be dead, and that failure must not mask the original error.
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
