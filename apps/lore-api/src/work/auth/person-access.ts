// One person's lock, keyed by their GitHub numeric id: a login can change hands, the id cannot (FR-388, FR-389). The person's generation, one integer that a removal or a revocation adds one to, lets a sign-in or a mint that began before it be refused after it (FR-434, FR-394).

import { runInTransaction, type PgPool } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  API_TOKEN_COLUMNS as COLUMNS,
  API_TOKEN_TABLE as TABLE,
  type ApiToken,
} from "@re-cinq/lore-shared/models/api-token.js";

/** Takes the person's lock until the transaction ends, so sign-in, minting and revocation for one person run one at a time (FR-388, FR-389). */
export async function lockPerson(
  tx: Pick<PgPool, "query">,
  githubId: number,
): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [githubId]);
}

/** The person's generation; a person with no row has generation 0 (FR-434). */
export async function generationOf(
  db: Pick<PgPool, "query">,
  githubId: number,
): Promise<number> {
  const { rows } = await db.query<{ generation: number }>(
    `SELECT generation FROM pipeline.person_generations WHERE github_id = $1`,
    [githubId],
  );

  return rows[0]?.generation ?? 0;
}

/** Ends every session of the person and revokes every token they minted, and adds one to their generation, all under the person's lock (FR-390, FR-394). */
export async function revokePersonAccess(
  db: PgPool,
  githubId: number,
): Promise<void> {
  await runInTransaction(db, async (tx) => {
    await lockPerson(tx, githubId);
    await tx.query(
      `INSERT INTO pipeline.person_generations (github_id, generation)
         VALUES ($1, 1)
         ON CONFLICT (github_id) DO UPDATE SET generation = pipeline.person_generations.generation + 1`,
      [githubId],
    );
    await tx.query(
      `UPDATE pipeline.api_tokens SET revoked_at = now()
         WHERE github_id = $1 AND revoked_at IS NULL`,
      [githubId],
    );
  });
}

type SessionState = Pick<ApiToken, "revokedAt" | "expiresAt" | "generation">;

const SESSION_STATE = `SELECT ${COLUMNS.revokedAt} AS "revokedAt", ${COLUMNS.expiresAt} AS "expiresAt", ${COLUMNS.generation} AS generation
  FROM ${TABLE} WHERE ${COLUMNS.tokenHash} = $1`;

/** Under the person's lock, a session that has been ended, or that was created under another generation of the person, mints nothing (FR-396, FR-438). */
export async function enforceSessionCurrent(
  db: Pick<PgPool, "query">,
  tokenHash: string | null,
  githubId: number,
): Promise<void> {
  const { rows } = await db.query<SessionState>(SESSION_STATE, [tokenHash]);
  const session = rows.at(0);

  enforceTrue(
    session && isOpen(session),
    apiError(401),
    "the session has ended",
  );
  enforceTrue(
    session.generation === (await generationOf(db, githubId)),
    apiError(401),
    "the session was created before the person's access changed",
  );
}

function isOpen({ revokedAt, expiresAt }: SessionState): boolean {
  return revokedAt === null && !hasLapsed(expiresAt);
}

function hasLapsed(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt <= new Date();
}
