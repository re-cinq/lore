import { createHash, randomBytes } from "node:crypto";
import type {
  CollabAuthenticator,
  PlanRole,
  Principal,
} from "@re-cinq/planning-sync";
import {
  PLAN_COLLAB_TOKEN_COLUMNS as COLUMNS,
  PLAN_COLLAB_TOKEN_TABLE as TABLE,
} from "@re-cinq/lore-shared/models/plan-collab-token.js";
import type { Db } from "../../outbound/plans/plan-store-pg.js";

/** How long a minted token opens its plan; the editor fetches a fresh one on every reconnect. */
export const COLLAB_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Who a token lets in, to which plan, with which role. */
export interface CollabGrant {
  planId: string;
  repo: string;
  user: { id: string; name: string };
  role: PlanRole;
  /** The session row (`pipeline.api_tokens.id`) the token was minted for; a token whose session ended is refused (FR-286, FR-301). */
  sessionId?: string | null;
}

const INSERT_TOKEN = `INSERT INTO ${TABLE} (${COLUMNS.tokenHash}, ${COLUMNS.planId},
  ${COLUMNS.repo}, ${COLUMNS.userId}, ${COLUMNS.userName}, ${COLUMNS.role}, ${COLUMNS.expiresAt}, ${COLUMNS.sessionId})
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
const SWEEP_EXPIRED = `DELETE FROM ${TABLE} WHERE ${COLUMNS.expiresAt} < now()`;
const SELECT_PRINCIPAL = `SELECT t.${COLUMNS.userId} AS id, t.${COLUMNS.userName} AS name,
  t.${COLUMNS.role} AS role, t.${COLUMNS.sessionId} AS "sessionId" FROM ${TABLE} t
  WHERE t.${COLUMNS.tokenHash} = $1 AND t.${COLUMNS.planId}::text = $2
    AND t.${COLUMNS.repo} = $3 AND t.${COLUMNS.expiresAt} > now()
    AND (t.${COLUMNS.sessionId} IS NULL OR EXISTS (
      SELECT 1 FROM pipeline.api_tokens s
      WHERE s.id::text = t.${COLUMNS.sessionId} AND s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > now())))`;

/** The session each token this replica minted was minted for, until it expires: what a connection opened with it is closed by when that session ends (FR-304). */
const mintedFor = new Map<string, { sessionId: string; expiresAt: Date }>();

const hashOf = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** A fresh opaque token for one plan and one person; only its sha256 is stored, and expired ones are swept as new ones are minted. */
export async function mintCollabToken(
  db: Db,
  { planId, repo, user, role, sessionId }: CollabGrant,
  expiresAt = new Date(Date.now() + COLLAB_TOKEN_TTL_MS),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  rememberSession(hashOf(token), sessionId, expiresAt);
  await db().query(SWEEP_EXPIRED);
  await db().query(INSERT_TOKEN, [
    hashOf(token),
    planId,
    repo,
    user.id,
    user.name,
    role,
    expiresAt,
    sessionId ?? null,
  ]);

  return token;
}

function rememberSession(
  hash: string,
  sessionId: string | null | undefined,
  expiresAt: Date,
): void {
  for (const [key, entry] of mintedFor) {
    if (entry.expiresAt.getTime() < Date.now()) {
      mintedFor.delete(key);
    }
  }

  if (sessionId) {
    mintedFor.set(hash, { sessionId, expiresAt });
  }
}

/** The CollabAuthenticator planning-sync asks: a live token minted for exactly this plan of this repo, or nobody. */
export function collabAuthenticator(db: Db): CollabAuthenticator {
  return {
    authenticate: async (token, { repo, planId }) => {
      const { rows } = await db().query<Principal>(SELECT_PRINCIPAL, [
        hashOf(token),
        planId,
        repo,
      ]);

      return rows.length === 0 ? null : withSession(rows[0], hashOf(token));
    },
  };
}

function withSession(principal: Principal, hash: string): Principal {
  const { sessionId: stored, ...rest } = principal as Principal & {
    sessionId?: string | null;
  };
  const sessionId = stored ?? mintedFor.get(hash)?.sessionId;

  return (sessionId ? { ...rest, sessionId } : rest) as Principal;
}
