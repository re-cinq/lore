// Seeds the shipped default agents into lore.agent_definitions at lore-api boot (specs/lore-agents FR27).

import type { PgPool } from "../../memory-store.js";
import { runInTransaction } from "../../db/pg-transaction.js";
import {
  planSeed,
  type SeedPlan,
} from "../../../domain/agent-defaults/shipped-default.js";
import {
  ShippedFieldsSchema,
  type ResolvedAgentDefinition,
  type ShippedFields,
} from "../../../domain/models/agent-definition.js";
import {
  SEED_INSERT_SQL,
  SEED_LOCK_SQL,
  SEED_REMEMBER_SQL,
  SEED_ROWS_SQL,
  SEED_UPDATE_SQL,
} from "./agent-defs-sql.js";

export interface SeedResult {
  inserted: string[];
  updated: string[];
  diverged: string[];
}

type OrgRow = ShippedFields & {
  name: string;
  shipped_default: ShippedFields | null;
};

type Tx = Pick<PgPool, "query">;

// One transaction under an advisory lock: replicas booting together seed once, and a failed boot leaves the previous rows.
export async function seedAgentDefaults(
  pool: PgPool,
  defaults: ResolvedAgentDefinition[],
): Promise<SeedResult> {
  return runInTransaction(pool, async (tx) => {
    await tx.query(SEED_LOCK_SQL);
    const { rows } = await tx.query<OrgRow>(SEED_ROWS_SQL, [
      defaults.map((d) => d.name),
    ]);
    const byName = new Map(rows.map((row) => [row.name, row]));
    const result: SeedResult = { inserted: [], updated: [], diverged: [] };

    for (const shipped of defaults) {
      await seedRow(tx, byName.get(shipped.name), shipped, result);
    }

    return result;
  });
}

async function seedRow(
  tx: Tx,
  row: OrgRow | undefined,
  shipped: ResolvedAgentDefinition,
  result: SeedResult,
): Promise<void> {
  const next = ShippedFieldsSchema.parse(shipped);
  const plan = planSeed(
    row && ShippedFieldsSchema.parse(row),
    row?.shipped_default ?? null,
    next,
  );

  await applySeedPlan(tx, shipped.name, plan, next);
  recordPlan(result, shipped.name, plan);
}

async function applySeedPlan(
  client: Tx,
  name: string,
  plan: SeedPlan,
  next: ShippedFields,
): Promise<void> {
  const remembered = JSON.stringify(next);

  if (plan.write === "insert" || plan.write === "rewrite") {
    const sql = plan.write === "insert" ? SEED_INSERT_SQL : SEED_UPDATE_SQL;

    await client.query(sql, [name, ...fieldParams(plan.fields), remembered]);
  }

  if (plan.write === "remember") {
    await client.query(SEED_REMEMBER_SQL, [name, remembered]);
  }
}

function recordPlan(result: SeedResult, name: string, plan: SeedPlan): void {
  if (plan.write === "insert") {
    result.inserted.push(name);
  }

  if (plan.write === "rewrite") {
    result.updated.push(name);
  }

  if (plan.diverged) {
    result.diverged.push(name);
  }
}

function fieldParams(fields: ShippedFields): unknown[] {
  return [
    fields.model,
    fields.timeout_minutes,
    fields.prompt,
    fields.execution_mode,
    fields.review_required,
    fields.config === null ? null : JSON.stringify(fields.config),
  ];
}
