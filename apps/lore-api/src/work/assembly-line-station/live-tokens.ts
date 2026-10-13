// The token that opens one run's channel of the live socket as one person (ADR-048): minted at the web tier's request after it checked the session and repo access, stored as a sha256, verified when the channel opens. Mirrors the plan collab tokens.

import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  LIVE_TOKEN_COLUMNS as COLUMNS,
  LIVE_TOKEN_TABLE as TABLE,
  type LiveToken,
} from "@re-cinq/lore-shared/models/live-token.js";

export type Db = () => Pool;

/** How long a minted token opens its subject; the browser fetches a fresh one for every open. */
export const LIVE_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface LiveGrant {
  kind: LiveToken["kind"];
  subject: string;
  user: { id: string; name: string };
}

export interface LivePrincipal {
  id: string;
  name: string;
}

/** The verify side of the token, so a channel handler can be tested without a database. */
export type LiveTokenVerifier = (
  token: string,
  claim: Pick<LiveGrant, "kind" | "subject">,
) => Promise<LivePrincipal | null>;

const INSERT_TOKEN = `INSERT INTO ${TABLE} (${COLUMNS.tokenHash}, ${COLUMNS.kind},
  ${COLUMNS.subject}, ${COLUMNS.userId}, ${COLUMNS.userName}, ${COLUMNS.expiresAt})
  VALUES ($1, $2, $3, $4, $5, $6)`;
const SWEEP_EXPIRED = `DELETE FROM ${TABLE} WHERE ${COLUMNS.expiresAt} < now()`;
const SELECT_PRINCIPAL = `SELECT ${COLUMNS.userId} AS id, ${COLUMNS.userName} AS name
  FROM ${TABLE}
  WHERE ${COLUMNS.tokenHash} = $1 AND ${COLUMNS.kind} = $2
    AND ${COLUMNS.subject} = $3 AND ${COLUMNS.expiresAt} > now()`;

const hashOf = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** A fresh opaque token for one subject and one person; expired ones are swept as new ones are minted. */
export async function mintLiveToken(
  db: Db,
  grant: LiveGrant,
  expiresAt = new Date(Date.now() + LIVE_TOKEN_TTL_MS),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");

  await db().query(SWEEP_EXPIRED);
  await db().query(INSERT_TOKEN, [
    hashOf(token),
    grant.kind,
    grant.subject,
    grant.user.id,
    grant.user.name,
    expiresAt,
  ]);

  return { token, expiresAt };
}

/** The person a live token was minted for, when it names exactly this subject and has not expired; nobody otherwise. */
export function liveTokenVerifier(db: Db): LiveTokenVerifier {
  return async (token, { kind, subject }) => {
    const { rows } = await db().query<LivePrincipal>(SELECT_PRINCIPAL, [
      hashOf(token),
      kind,
      subject,
    ]);

    return rows[0] ?? null;
  };
}

/** The in-memory verifier: whatever was minted through it opens, nothing else does. */
export function memoryLiveTokens() {
  const minted = new Map<string, LiveGrant>();

  return {
    mint(grant: LiveGrant): string {
      const token = randomBytes(8).toString("base64url");

      minted.set(token, grant);

      return token;
    },
    verify: (async (token, claim) => {
      const grant = minted.get(token);
      const matches =
        grant?.kind === claim.kind && grant.subject === claim.subject;

      return matches ? { id: grant.user.id, name: grant.user.name } : null;
    }) satisfies LiveTokenVerifier,
  };
}
