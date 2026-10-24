// What Utopia answers when Lore reads its mirror back: a scored search page, and a pushed document by its external id. The shapes are Utopia v0.1.0-re.7's: `ScoredChunk` (retrieval.rs) flattening `SourcedChunk` and `ChunkView` (utopia-core models.rs) on `POST /kbs/{id}/search`, and the `by_external_id` answer of documents_routes.rs; the fixtures beside this module copy them.

import { z } from "zod";

const scoredChunkSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  seq: z.number(),
  text: z.string(),
  filename: z.string(),
  source_id: z.string().nullable(),
  external_id: z.string().nullable(),
  score: z.number(),
  bm25_rank: z.number().nullable(),
  vector_rank: z.number().nullable(),
});

const searchPageSchema = z.object({
  results: z.array(scoredChunkSchema),
  has_more: z.boolean(),
  vector_used: z.boolean(),
});

export interface SearchHit {
  chunkId: string;
  documentId: string;
  seq: number;
  text: string;
  filename: string;
  /** Null on a chunk of an uploaded file; a pushed source names itself. */
  sourceId: string | null;
  /** The id Lore pushed the item under, such as `stmt:specs/utopia-graph-mirror/spec.md#0003.2`; null when no push made it. */
  externalId: string | null;
  score: number;
  /** 1-based; null when the keyword arm missed the chunk. */
  bm25Rank: number | null;
  /** 1-based; null when the vector arm missed the chunk or did not run. */
  vectorRank: number | null;
}

export interface SearchPage {
  hits: SearchHit[];
  hasMore: boolean;
  /** False when Utopia answered from keywords alone. */
  vectorUsed: boolean;
}

export function parseSearchPage(json: unknown): SearchPage {
  const page = searchPageSchema.parse(json);

  return {
    hits: page.results.map((hit) => ({
      chunkId: hit.id,
      documentId: hit.document_id,
      seq: hit.seq,
      text: hit.text,
      filename: hit.filename,
      sourceId: hit.source_id,
      externalId: hit.external_id,
      score: hit.score,
      bm25Rank: hit.bm25_rank,
      vectorRank: hit.vector_rank,
    })),
    hasMore: page.has_more,
    vectorUsed: page.vector_used,
  };
}

const storedDocumentSchema = z.object({
  id: z.string(),
  external_id: z.string(),
  filename: z.string(),
  status: z.string(),
  doc_time: z.string().nullable(),
  version: z.number(),
  content: z.string(),
});

export interface StoredDocument {
  id: string;
  externalId: string;
  filename: string;
  status: string;
  docTime: string | null;
  version: number;
  /** The newest version as pushed: a statements item is its JSON body. */
  content: string;
}

export function parseStoredDocument(json: unknown): StoredDocument {
  const document = storedDocumentSchema.parse(json);

  return {
    id: document.id,
    externalId: document.external_id,
    filename: document.filename,
    status: document.status,
    docTime: document.doc_time,
    version: document.version,
    content: document.content,
  };
}

const DOC_ID = /^doc:(.+)$/;

/** The file a `doc:<path>` external id Lore pushed names; null for any other id. */
export function docPathOf(externalId: string): string | null {
  return DOC_ID.exec(externalId)?.[1] ?? null;
}
