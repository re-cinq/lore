import { enforceChunkSchema } from "../chunks/chunk-schema.js";
import type { RepoKeyedTable } from "./repo-move-registry.js";

type MovedTable = Extract<RepoKeyedTable, { policy: "move" }>;

/** What a move's single statement reports: the rows held under the mirror's name before it, and the rows it moved. */
export interface MoveStatementCounts {
  held: number;
  moved: number;
}

const COUNTS_SQL = `SELECT (SELECT total FROM holding)::int AS held, (SELECT count(*) FROM moving)::int AS moved`;

/** Moves the mirror's rows ($1) to the private name ($2) unless a row with the same key already sits under it. Identifiers come from the registry only. */
export function moveTableSql(entry: MovedTable): string {
  const table = `${entry.schema}.${entry.table}`;
  const column = `"${entry.repoColumn}"`;
  const sameKey = entry.keyColumns.map(sameKeyOn);

  return `WITH holding AS (SELECT count(*) AS total FROM ${table} WHERE ${column} = $1),
     moving AS (
       UPDATE ${table} source SET ${column} = $2
        WHERE source.${column} = $1
          AND NOT EXISTS (SELECT 1 FROM ${table} held
                           WHERE lower(held.${column}) = lower($2)${sameKey.join("")})
       RETURNING 1)
${COUNTS_SQL}`;
}

function sameKeyOn(keyColumn: string): string {
  return ` AND held."${keyColumn}" IS NOT DISTINCT FROM source."${keyColumn}"`;
}

/** Moves the mirror's chunks ($1) of one schema into the private repo's schema, stamping its team ($3). A chunk whose file the private repo already holds stays. */
export function moveChunksSql(
  sourceSchema: string,
  targetSchema: string,
): string {
  enforceChunkSchema(sourceSchema);
  enforceChunkSchema(targetSchema);

  return `WITH holding AS (SELECT count(*) AS total FROM ${sourceSchema}.chunks WHERE repo = $1),
${leavingChunks(sourceSchema, targetSchema)},
${arrivingChunks(targetSchema)}
${COUNTS_SQL}`;
}

function leavingChunks(sourceSchema: string, targetSchema: string): string {
  const idTaken =
    sourceSchema === targetSchema
      ? ""
      : ` AND NOT EXISTS (SELECT 1 FROM ${targetSchema}.chunks taken WHERE taken.id = source.id)`;

  return `     leaving AS (
       DELETE FROM ${sourceSchema}.chunks source
        WHERE source.repo = $1
          AND NOT EXISTS (SELECT 1 FROM ${targetSchema}.chunks held
                           WHERE held.repo = $2
                             AND held.file_path IS NOT DISTINCT FROM source.file_path)${idTaken}
       RETURNING source.*)`;
}

function arrivingChunks(targetSchema: string): string {
  return `     moving AS (
       INSERT INTO ${targetSchema}.chunks
         (id, content, embedding, content_type, team, repo, file_path, author, ingested_at, metadata)
       SELECT id, content, embedding, content_type, $3, $2, file_path, author, ingested_at, metadata
         FROM leaving
       RETURNING 1)`;
}
