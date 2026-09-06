import { getQueryEmbedding } from "../../embeddings/embedding-service.js";
import type { PgPool } from "../../memory-store.js";
import { resolveChunkSchemaForRepo } from "../chunks/chunk-schema.js";
import type { SourceItem } from "./context-assembly-format.js";
import {
  mkItem,
  toScore,
  toIso,
  normalizeScores,
  extractKeyTerms,
} from "./context-assembly-items.js";

/** Hybrid RRF retrieval over the repo's resolved chunk schema: pgvector cosine leg + BM25 (ts_rank) leg, same as search_context; degrades to keyword-only with no query embedding. */

/** One hybrid-search HIT, not a chunk row — `score` is a ts_rank/cosine aggregate the query computes, no column holds it (the repo had three types named ChunkRow; this is the one that never described a table). */
export interface ChunkSearchHit {
  content: string;
  file_path: string;
  content_type?: string | null;
  ingested_at?: string | Date | null;
  score?: number | string | null;
  repo?: string;
}

export interface Incident {
  date: string;
  severity?: string;
  title?: string;
  resolved?: boolean;
  url?: string;
}

export async function hybridChunkItems(
  pool: PgPool,
  query: string,
  repo: string,
  { contentTypes, limit }: { contentTypes: string[]; limit: number },
): Promise<SourceItem[]> {
  const [embedding, schema] = await Promise.all([
    getQueryEmbedding(query),
    resolveChunkSchemaForRepo(pool, repo),
  ]);
  // Keyword leg searches distinctive terms (OR'd) rather than the whole paragraph, which would AND every filler word.
  const keywordQuery = extractKeyTerms(query).join(" OR ") || query;
  const mapRows = (rows: ChunkSearchHit[]): SourceItem[] =>
    normalizeScores(
      rows.map((r) =>
        mkItem(r.content, {
          source_path: r.file_path,
          content_type: r.content_type ?? contentTypes[0],
          score: toScore(r.score),
          ingested_at: toIso(r.ingested_at),
        }),
      ),
    );

  if (embedding) {
    const embStr = `[${embedding.join(",")}]`;
    const { rows } = await pool.query<ChunkSearchHit>(
      `WITH vec AS (
         SELECT id, content, file_path, content_type, ingested_at,
                ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector) AS r
         FROM ${schema}.chunks
         WHERE repo = $1 AND content_type = ANY($3) AND embedding IS NOT NULL
         LIMIT 20
       ),
       kw AS (
         SELECT id, content, file_path, content_type, ingested_at,
                ROW_NUMBER() OVER (ORDER BY ts_rank(search_tsv, websearch_to_tsquery('english', $4)) DESC) AS r
         FROM ${schema}.chunks
         WHERE repo = $1 AND content_type = ANY($3)
           AND search_tsv @@ websearch_to_tsquery('english', $4)
         LIMIT 20
       )
       SELECT COALESCE(v.content, k.content) AS content,
              COALESCE(v.file_path, k.file_path) AS file_path,
              COALESCE(v.content_type, k.content_type) AS content_type,
              COALESCE(v.ingested_at, k.ingested_at) AS ingested_at,
              (COALESCE(1.0 / (60 + v.r), 0) + COALESCE(1.0 / (60 + k.r), 0)) AS score
       FROM vec v FULL OUTER JOIN kw k ON v.id = k.id
       ORDER BY score DESC LIMIT $5`,
      [repo, embStr, contentTypes, keywordQuery, limit],
    );

    return mapRows(rows);
  }

  // Keyword-only fallback (no embedding available).
  const { rows } = await pool.query<ChunkSearchHit>(
    `SELECT content, file_path, content_type, ingested_at,
            ts_rank(search_tsv, websearch_to_tsquery('english', $2)) AS score
     FROM ${schema}.chunks
     WHERE repo = $1 AND content_type = ANY($3)
     ORDER BY score DESC NULLS LAST, ingested_at DESC LIMIT $4`,
    [repo, keywordQuery, contentTypes, limit],
  );

  return mapRows(rows);
}
