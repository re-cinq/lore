import type { Pool } from "pg";

/** One delta's view of the stored pointer: the commit it carries and the base it was diffed against. */
export interface DeltaCommit {
  repo: string;
  kind: string;
  commit: string;
  baseCommit: string | null;
}

const UNDEFINED_TABLE = "42P01";

/** A cluster whose `ingest_state` migration has not run yet reports this rather than a real failure. */
export function isUndefinedTableError(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === UNDEFINED_TABLE;
}

/** The stored commit, with a pre-migration cluster reading as "no state". */
export async function storedCommit(
  pool: Pool,
  repo: string,
  kind: string,
): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ commit_sha: string }>(
      `SELECT commit_sha FROM pipeline.ingest_state
        WHERE repo = $1 AND kind = $2`,
      [repo, kind],
    );

    return rows[0]?.commit_sha ?? null;
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return null;
    }

    throw err;
  }
}

const ADVANCE_COMMIT_SQL = `INSERT INTO pipeline.ingest_state (repo, kind, commit_sha)
             VALUES ($1, $2, $3)
             ON CONFLICT (repo, kind) DO UPDATE
               SET commit_sha = EXCLUDED.commit_sha, updated_at = now()
               WHERE pipeline.ingest_state.commit_sha IS NOT DISTINCT FROM $4
             RETURNING commit_sha`;

/** Compare-and-swap on the stored commit: it advances only if it still holds the base this delta was diffed against. "unrecorded" means the table does not exist yet. */
export async function advanceStoredCommit(
  pool: Pool,
  delta: DeltaCommit,
): Promise<boolean | "unrecorded"> {
  const { repo, kind, commit, baseCommit } = delta;

  try {
    const { rows } = await pool.query<{ commit_sha: string }>(
      ADVANCE_COMMIT_SQL,
      [repo, kind, commit, baseCommit],
    );

    return rows.length > 0;
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return "unrecorded";
    }

    throw err;
  }
}
