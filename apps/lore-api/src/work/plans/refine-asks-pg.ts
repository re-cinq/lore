// The pending Refine in Postgres, one row per plan: `lore.plan_refine_asks`.

import {
  PLAN_REFINE_ASK_COLUMNS as COLUMNS,
  PLAN_REFINE_ASK_TABLE as TABLE,
} from "@re-cinq/lore-shared/models/plan-refine-ask.js";
import type { Db } from "../../outbound/plans/plan-store-pg.js";
import type { RefineAsk, RefineAsks } from "./refine-asks.js";

const UPSERT = `INSERT INTO ${TABLE}
  (${COLUMNS.planId}, ${COLUMNS.slot}, ${COLUMNS.title}, ${COLUMNS.baseHash}, ${COLUMNS.inputs}, ${COLUMNS.uses}, ${COLUMNS.brief})
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (${COLUMNS.planId}) DO UPDATE SET
    ${COLUMNS.slot} = EXCLUDED.${COLUMNS.slot},
    ${COLUMNS.title} = EXCLUDED.${COLUMNS.title},
    ${COLUMNS.baseHash} = EXCLUDED.${COLUMNS.baseHash},
    ${COLUMNS.inputs} = EXCLUDED.${COLUMNS.inputs},
    ${COLUMNS.uses} = EXCLUDED.${COLUMNS.uses},
    ${COLUMNS.brief} = EXCLUDED.${COLUMNS.brief},
    ${COLUMNS.askedAt} = now()`;

const SELECT_PENDING = `SELECT ${COLUMNS.slot}, ${COLUMNS.title},
  ${COLUMNS.baseHash} AS "baseHash", ${COLUMNS.inputs}, ${COLUMNS.uses}, ${COLUMNS.brief}
  FROM ${TABLE} WHERE ${COLUMNS.planId}::text = $1`;

const DELETE_PENDING = `DELETE FROM ${TABLE} WHERE ${COLUMNS.planId}::text = $1`;

interface PendingRow {
  slot: string;
  title: string;
  baseHash: string;
  inputs: unknown;
  uses: unknown;
  brief: string;
}

export function pgRefineAsks(db: Db): RefineAsks {
  return {
    record: (ask) => record(db, ask),
    pending: async (planId) => {
      const { rows } = await db().query<PendingRow>(SELECT_PENDING, [planId]);
      const row = rows.at(0);

      return row ? { planId, ...row } : null;
    },
    clear: async (planId) => {
      await db().query(DELETE_PENDING, [planId]);
    },
  };
}

async function record(db: Db, ask: RefineAsk): Promise<void> {
  await db().query(UPSERT, [
    ask.planId,
    ask.slot,
    ask.title,
    ask.baseHash,
    jsonOf(ask.inputs),
    jsonOf(ask.uses),
    ask.brief,
  ]);
}

// A jsonb column takes the text of the value, and `undefined` is SQL NULL rather than the string "undefined".
function jsonOf(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export type { RefineAsk };
