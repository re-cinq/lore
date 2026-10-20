// What Utopia answers when Lore reads its mirror back: a scored search page, a pushed document by its external id, and the statements item a chunk of a statements source holds. The shapes are Utopia v0.1.0-re.7's: `ScoredChunk` (retrieval.rs) flattening `SourcedChunk` and `ChunkView` (utopia-core models.rs) on `POST /kbs/{id}/search`, and the `by_external_id` answer of documents_routes.rs; the fixtures beside this module copy them.

import { z } from "zod";
import type { Entity, Statement } from "./statements.js";

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
  missing_since: z.string().nullable(),
  version: z.number(),
  content: z.string(),
});

export interface StoredDocument {
  id: string;
  externalId: string;
  filename: string;
  status: string;
  docTime: string | null;
  /** Set when a tombstone marked the item missing; only read with `include_missing`. */
  missingSince: string | null;
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
    missingSince: document.missing_since,
    version: document.version,
    content: document.content,
  };
}

export type PushedKind = "doc" | "stmt" | "test" | "code";

export interface PushedPath {
  kind: PushedKind;
  path: string;
  /** A statement's ordinal within its document. */
  ordinal?: number;
}

const STATEMENT_ID = /^stmt:(.+)#(\d+)(?:\.\d+)?$/;

const FILE_ID = /^(doc|test|code):(.+?)(?:\.\d+)?$/;

/** The file an external id Lore pushed names, its split suffix (`.2`) dropped; null for an id no Lore push makes. */
export function pushedPathOf(externalId: string): PushedPath | null {
  const statement = STATEMENT_ID.exec(externalId);

  if (statement) {
    return { kind: "stmt", path: statement[1], ordinal: Number(statement[2]) };
  }
  const file = FILE_ID.exec(externalId);

  return file ? { kind: file[1] as PushedKind, path: file[2] } : null;
}

const ENTITY_MARK = z.custom<true>((mark) => mark === true);

const statementsChunkSchema = z.object({
  external_id: z.string(),
  e: z.array(z.tuple([z.string(), z.string(), ENTITY_MARK])),
  s: z.array(
    z.tuple([
      z.null(),
      z.string(),
      z.string(),
      z.string().nullable(),
      z.string().nullable(),
      z.record(z.string(), z.union([z.string(), z.number()])),
      z.null(),
      z.null(),
    ]),
  ),
});

export interface StatementsChunk {
  externalId: string;
  e: Entity[];
  s: Statement[];
}

/** The statements item a chunk holds, or null when the chunk is not one whole item (a long item is cut across chunks). */
export function parseStatementsChunk(text: string): StatementsChunk | null {
  const parsed = statementsChunkSchema.safeParse(jsonOrNull(text));

  return parsed.success
    ? {
        externalId: parsed.data.external_id,
        e: parsed.data.e,
        s: parsed.data.s,
      }
    : null;
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A chunk cut mid-item is not JSON, and that is an answer, not a failure.
    return null;
  }
}

/** The words of an item's `text` attributes, in pushed order. */
export function statementTexts(
  statementsItem: Pick<StatementsChunk, "s">,
): string[] {
  return statementsItem.s.flatMap(([, , phrase, , value]) =>
    phrase === "text" && value !== null ? [value] : [],
  );
}
