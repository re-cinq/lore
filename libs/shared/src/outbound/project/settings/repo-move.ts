import { enforceTrue } from "../../../lib/enforce.js";
import { hasConnect, type PgPool } from "../../../domain/memory-store-types.js";
import {
  chunkSchemaOrOrgShared,
  listChunkSchemas,
} from "../chunks/chunk-schema.js";
import { runInTransaction } from "../../db/pg-transaction.js";
import { REPO_KEYED_TABLES } from "./repo-move-registry.js";
import {
  moveChunksSql,
  moveTableSql,
  type MoveStatementCounts,
} from "./repo-move-sql.js";

/** What a move did to one table: rows now under the private name, and rows that stayed under the mirror's because the private name already holds the same key. */
export interface KnowledgeMoveCount {
  table: string;
  moved: number;
  kept_conflict: number;
}

export interface KnowledgeMoveOptions {
  dryRun: boolean;
}

type Transaction = Pick<PgPool, "query">;

/** Ends a dry run's transaction by throwing, so it rolls back. */
class DryRunRollback extends Error {}

/** Moves what Lore stored under a public mirror's name to its private repo, in one transaction. A dry run does the same work and rolls it back, so its counts are the ones a real run produces. */
export async function moveRepoKnowledge(
  db: PgPool,
  from: string,
  to: string,
  { dryRun }: KnowledgeMoveOptions,
): Promise<KnowledgeMoveCount[]> {
  enforceTrue(hasConnect(db), Error, "moving knowledge needs a pool");
  const done: { counts: KnowledgeMoveCount[] } = { counts: [] };

  await runInTransaction(db, async (tx) => {
    done.counts = await moveRows(tx, from, to);
    enforceTrue(!dryRun, DryRunRollback, "dry run: rolled back");
  }).catch((err: unknown) =>
    err instanceof DryRunRollback ? undefined : Promise.reject(err),
  );

  return done.counts;
}

async function moveRows(
  tx: Transaction,
  from: string,
  to: string,
): Promise<KnowledgeMoveCount[]> {
  const counts: KnowledgeMoveCount[] = [];

  for (const entry of REPO_KEYED_TABLES) {
    if (entry.policy === "chunks") {
      counts.push(...(await moveChunks(tx, from, to)));
    }

    if (entry.policy === "move") {
      const { rows } = await tx.query<MoveStatementCounts>(
        moveTableSql(entry),
        [from, to],
      );

      counts.push(countOf(`${entry.schema}.${entry.table}`, rows));
    }
  }

  return counts;
}

async function moveChunks(
  tx: Transaction,
  from: string,
  to: string,
): Promise<KnowledgeMoveCount[]> {
  const targetSchema = await chunkSchemaOf(tx, to);
  const counts: KnowledgeMoveCount[] = [];

  for (const sourceSchema of await listChunkSchemas(tx)) {
    const { rows } = await tx.query<MoveStatementCounts>(
      moveChunksSql(sourceSchema, targetSchema),
      [from, to, targetSchema],
    );

    counts.push(countOf(`${sourceSchema}.chunks`, rows));
  }

  return counts;
}

async function chunkSchemaOf(tx: Transaction, repo: string): Promise<string> {
  const { rows } = await tx.query<{ team: string | null }>(
    "SELECT team FROM lore.repos WHERE full_name = $1",
    [repo],
  );

  return chunkSchemaOrOrgShared(tx, rows[0]?.team);
}

function countOf(
  table: string,
  [counts]: MoveStatementCounts[],
): KnowledgeMoveCount {
  return {
    table,
    moved: counts.moved,
    kept_conflict: counts.held - counts.moved,
  };
}
