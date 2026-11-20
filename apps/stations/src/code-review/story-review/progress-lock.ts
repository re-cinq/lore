import type { Pool } from "pg";

/** Runs `publish` while holding the lock of one pull request's review comment, so two workers never write it at once. */
export async function withProgressLock(
  pool: Pool,
  key: string,
  publish: () => Promise<void>,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [key],
    );
    await publish();
  } finally {
    // The transaction only holds the cross-worker lock. Discard the connection if release fails.
    await client.query("ROLLBACK").then(
      () => client.release(),
      () => client.release(new Error("Could not release shadow review lock")),
    );
  }
}
