// One person's lock, keyed by their GitHub numeric id: a login can change hands, the id cannot (FR-388, FR-389).

import type { PgPool } from "@re-cinq/lore-shared";

/** Takes the person's lock until the transaction ends, so sign-in, minting and revocation for one person run one at a time (FR-388, FR-389). */
export async function lockPerson(
  tx: Pick<PgPool, "query">,
  githubId: number,
): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [githubId]);
}
