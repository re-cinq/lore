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
}

const INSERT_TOKEN = `INSERT INTO ${TABLE} (${COLUMNS.tokenHash}, ${COLUMNS.planId},
  ${COLUMNS.repo}, ${COLUMNS.userId}, ${COLUMNS.userName}, ${COLUMNS.role}, ${COLUMNS.expiresAt})
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;
const SWEEP_EXPIRED = `DELETE FROM ${TABLE} WHERE ${COLUMNS.expiresAt} < now()`;
const SELECT_PRINCIPAL = `SELECT ${COLUMNS.userId} AS id, ${COLUMNS.userName} AS name,
  ${COLUMNS.role} AS role FROM ${TABLE}
  WHERE ${COLUMNS.tokenHash} = $1 AND ${COLUMNS.planId}::text = $2
    AND ${COLUMNS.repo} = $3 AND ${COLUMNS.expiresAt} > now()`;

const hashOf = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** A fresh opaque token for one plan and one person; only its sha256 is stored, and expired ones are swept as new ones are minted. */
export async function mintCollabToken(
  db: Db,
  grant: CollabGrant,
  expiresAt = new Date(Date.now() + COLLAB_TOKEN_TTL_MS),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { planId, repo, user, role } = grant;

  await db().query(SWEEP_EXPIRED);
  await db().query(INSERT_TOKEN, [
    hashOf(token),
    planId,
    repo,
    user.id,
    user.name,
    role,
    expiresAt,
  ]);

  return token;
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

      return rows[0] ?? null;
    },
  };
}
