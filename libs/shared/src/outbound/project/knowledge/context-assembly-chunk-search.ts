import { getQueryEmbedding } from "../../embeddings/embedding-service.js";
import type { PgPool } from "../../memory-store.js";
import { resolveChunkSchemaForRepo } from "../chunks/chunk-schema.js";
import type { SourceItem } from "./context-assembly-format.js";
import { stripCoverageLinks } from "../../../domain/spec-link-strip.js";
import {
  mkItem,
  toScore,
  toIso,
  normalizeScores,
  extractKeyTerms,
} from "./context-assembly-items.js";

/** Hybrid RRF retrieval over the repo's resolved chunk schema: pgvector cosine leg + BM25 (ts_rank) leg, same as search_context; degrades to keyword-only with no query embedding. */

/** One hybrid-search HIT, not a chunk row — `score` is a ts_rank/cosine aggregate the query computes, no column holds it (the repo had three types named ChunkRow; this is the one that never described a table). */
// eslint-disable-next-line re-lint/no-row-types-outside-models -- the search query's own projection: score is computed, content_hash is lifted out of the metadata jsonb
export interface ChunkSearchHit {
  content: string;
  file_path: string;
  content_type?: string | null;
  ingested_at?: string | Date | null;
  score?: number | string | null;
  repo?: string;
  content_hash?: string | null;
}

// The hash travels with the hit so two paths holding one body (a file and its copied twin) collapse to one document.
const HIT_COLUMNS =
  "content, file_path, content_type, ingested_at, metadata->>'content_hash' AS content_hash";

export interface Incident {
  date: string;
  severity?: string;
  title?: string;
  resolved?: boolean;
  url?: string;
}

/** The two independent ranking legs — nearest-neighbour and keyword — as CTEs, each capped at 20 candidates before fusion. */
function hybridLegsSql(schema: string): string {
  return `WITH vec AS (
         SELECT id, ${HIT_COLUMNS},
                ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector) AS r
         FROM ${schema}.chunks
         WHERE repo = $1 AND content_type = ANY($3) AND embedding IS NOT NULL
         LIMIT 20
       ),
       kw AS (
         SELECT id, ${HIT_COLUMNS},
                ROW_NUMBER() OVER (ORDER BY ts_rank(search_tsv, websearch_to_tsquery('english', $4)) DESC) AS r
         FROM ${schema}.chunks
         WHERE repo = $1 AND content_type = ANY($3)
           AND search_tsv @@ websearch_to_tsquery('english', $4)
         LIMIT 20
       )`;
}

/** Reciprocal Rank Fusion over the two legs, joined FULL OUTER so a chunk that only one leg finds still scores. The 60 is RRF's usual damping: it stops a single leg's top hit from dominating a chunk both legs rank moderately. */
function hybridSql(schema: string): string {
  return `${hybridLegsSql(schema)}
       SELECT COALESCE(v.content, k.content) AS content,
              COALESCE(v.file_path, k.file_path) AS file_path,
              COALESCE(v.content_type, k.content_type) AS content_type,
              COALESCE(v.ingested_at, k.ingested_at) AS ingested_at,
              COALESCE(v.content_hash, k.content_hash) AS content_hash,
              (COALESCE(1.0 / (60 + v.r), 0) + COALESCE(1.0 / (60 + k.r), 0)) AS score
       FROM vec v FULL OUTER JOIN kw k ON v.id = k.id
       ORDER BY score DESC LIMIT $5`;
}

/** Search hits as context items, with scores normalized across the batch. Normalization matters because the two legs score on different scales — a raw vector distance beside a ts_rank would let one source crowd out the other regardless of relevance. */
function toItems(rows: ChunkSearchHit[], contentTypes: string[]): SourceItem[] {
  return normalizeScores(
    rows.map((r) =>
      // Stripped here, not at ingest: the stored chunk keeps its links for the coverage validators; the agent's bundle does not need them.
      mkItem(stripCoverageLinks(r.content), {
        source_path: r.file_path,
        content_type: r.content_type ?? contentTypes[0],
        score: toScore(r.score),
        ingested_at: toIso(r.ingested_at),
        ...(r.content_hash ? { content_hash: r.content_hash } : {}),
      }),
    ),
  );
}

// A non-matching chunk scores 0, not NULL, so without the `@@` filter a query matching nothing returned the newest chunks of the type — the same three for every question, for as long as the vector leg was down.
function keywordOnlySql(schema: string): string {
  return `SELECT ${HIT_COLUMNS},
            ts_rank(search_tsv, websearch_to_tsquery('english', $2)) AS score
     FROM ${schema}.chunks
     WHERE repo = $1 AND content_type = ANY($3)
       AND search_tsv @@ websearch_to_tsquery('english', $2)
     ORDER BY score DESC, ingested_at DESC LIMIT $4`;
}

interface ChunkQuery {
  repo: string;
  keywordQuery: string;
  contentTypes: string[];
  limit: number;
}

async function hybridRankedItems(
  pool: PgPool,
  schema: string,
  embedding: number[],
  chunkQuery: ChunkQuery,
): Promise<SourceItem[]> {
  const { rows } = await pool.query<ChunkSearchHit>(hybridSql(schema), [
    chunkQuery.repo,
    `[${embedding.join(",")}]`,
    chunkQuery.contentTypes,
    chunkQuery.keywordQuery,
    chunkQuery.limit,
  ]);

  return toItems(rows, chunkQuery.contentTypes);
}

/** Keyword-only fallback: with no embedding the vector leg has nothing to compare against, so ranking falls back to text relevance alone. */
async function keywordRankedItems(
  pool: PgPool,
  schema: string,
  chunkQuery: ChunkQuery,
): Promise<SourceItem[]> {
  const { rows } = await pool.query<ChunkSearchHit>(keywordOnlySql(schema), [
    chunkQuery.repo,
    chunkQuery.keywordQuery,
    chunkQuery.contentTypes,
    chunkQuery.limit,
  ]);

  return toItems(rows, chunkQuery.contentTypes);
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
  const chunkQuery = { repo, keywordQuery, contentTypes, limit };

  return embedding
    ? hybridRankedItems(pool, schema, embedding, chunkQuery)
    : keywordRankedItems(pool, schema, chunkQuery);
}
