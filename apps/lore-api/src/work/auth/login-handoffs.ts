// The one-time codes of the GitHub sign-in lore-api runs for the web UI: a `state` code carries the page that began it through GitHub, a `redeem` code carries the signed-in person back to that page. Stored as a sha256 and deleted when taken, so a code works once.

import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  LOGIN_HANDOFF_COLUMNS as COLUMNS,
  LOGIN_HANDOFF_TABLE as TABLE,
  type LoginHandoff,
  type UserGrant,
} from "@re-cinq/lore-shared/models/login-handoff.js";
import { HANDOFF_TTL_MS } from "./login-grant.js";

export { HANDOFF_TTL_MS };

export type HandoffPhase = LoginHandoff["phase"];

export interface HandoffContent {
  returnUrl: string;
  grant: UserGrant | null;
}

export interface LoginHandoffs {
  /** Stores the content and returns the raw code that takes it back. */
  put(phase: HandoffPhase, content: HandoffContent): Promise<string>;
  /** The content of a code of this phase that has not expired; the code is spent either way. */
  take(code: string, phase: HandoffPhase): Promise<HandoffContent | null>;
}

const INSERT = `INSERT INTO ${TABLE} (${COLUMNS.codeHash}, ${COLUMNS.phase},
  ${COLUMNS.returnUrl}, ${COLUMNS.grant}, ${COLUMNS.expiresAt})
  VALUES ($1, $2, $3, $4, $5)`;
const SWEEP_EXPIRED = `DELETE FROM ${TABLE} WHERE ${COLUMNS.expiresAt} < now()`;
const TAKE = `DELETE FROM ${TABLE}
  WHERE ${COLUMNS.codeHash} = $1 AND ${COLUMNS.phase} = $2 AND ${COLUMNS.expiresAt} > now()
  RETURNING ${COLUMNS.returnUrl} AS "returnUrl", ${COLUMNS.grant} AS grant`;

const hashOf = (code: string): string =>
  createHash("sha256").update(code).digest("hex");
const newCode = (): string => randomBytes(32).toString("base64url");

export function pgLoginHandoffs(db: () => Pool): LoginHandoffs {
  return {
    async put(phase, { returnUrl, grant }) {
      const code = newCode();

      await db().query(SWEEP_EXPIRED);
      await db().query(INSERT, [
        hashOf(code),
        phase,
        returnUrl,
        JSON.stringify(grant),
        new Date(Date.now() + HANDOFF_TTL_MS),
      ]);

      return code;
    },
    async take(code, phase) {
      const { rows } = await db().query<HandoffContent>(TAKE, [
        hashOf(code),
        phase,
      ]);

      return rows[0] ?? null;
    },
  };
}

/** The in-memory store: what was put in comes out once, until its time is up. */
export function memoryLoginHandoffs(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const stored = new Map<
    string,
    HandoffContent & { phase: HandoffPhase; expiresAt: number }
  >();

  return {
    async put(phase: HandoffPhase, content: HandoffContent) {
      const code = newCode();

      stored.set(hashOf(code), {
        ...content,
        phase,
        expiresAt: now() + HANDOFF_TTL_MS,
      });

      return code;
    },
    async take(code: string, phase: HandoffPhase) {
      const key = hashOf(code);
      const row = stored.get(key);

      if (!row || row.phase !== phase) {
        return null;
      }
      stored.delete(key);

      return row.expiresAt > now()
        ? { returnUrl: row.returnUrl, grant: row.grant }
        : null;
    },
  } satisfies LoginHandoffs;
}
