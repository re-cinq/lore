// The docs-source documents of the Utopia arm (specs/utopia-graph-mirror FR13.10): a search's hits grouped by the document they came from, scored, kept above the relevance floor, and widened from chunks to the statements they were cut from.

import { classifyFile } from "../../../domain/content-classify.js";
import { withoutLocation } from "../../../domain/utopia/docs/doc-text.js";
import {
  docPathOf,
  type SearchHit,
  type StoredDocument,
} from "../../../domain/utopia/read-shapes.js";
import type { SourceItem } from "./context-assembly-format.js";
import { mkItem, normalizeScores } from "./context-assembly-items.js";
import { widenedChunks } from "./context-assembly-utopia-sections.js";

/** A document is kept only while its best hit scores at least this share of the search's best document hit: of 36 eval questions, documents at or above it were used by the answer 74% of the time and those under it 15%, and every question's own document stood above it (2026-11-01). */
const RELEVANCE_FLOOR = 0.75;

export interface DocumentFilter {
  docsSourceId: string;
  types: ReadonlySet<string>;
  limit: number;
}

interface DocumentHits {
  path: string;
  contentType: string;
  score: number;
  chunks: { seq: number; text: string }[];
}

/** The documents the hits name, one item each in the rank of its best hit, scored so the best is 1 as Lore's are: the docs source's chunks only, every chunk of a document that matched, in the order they stand in it. */
export function utopiaDocuments(
  hits: SearchHit[],
  filter: DocumentFilter,
): SourceItem[] {
  return normalizeScores(documentHits(hits, filter).map(toItem));
}

/** The same documents, each hit widened to the statement it was cut from in the stored document (FR13.10); a document Utopia no longer holds keeps its chunks. */
export async function widenedDocuments(
  hits: SearchHit[],
  filter: DocumentFilter,
  stored: (path: string) => Promise<StoredDocument | null>,
): Promise<SourceItem[]> {
  const documents = await Promise.all(
    documentHits(relevantHits(hits, filter.docsSourceId), filter).map(
      async (document) => {
        const whole = await stored(document.path);

        return whole ? widened(document, whole.content) : document;
      },
    ),
  );

  return normalizeScores(documents.map(toItem));
}

function widened(document: DocumentHits, content: string): DocumentHits {
  const chunks = [...document.chunks].sort((a, b) => a.seq - b.seq);
  const texts = widenedChunks(
    withoutLocation(content),
    chunks.map((chunk) => chunk.text),
  );

  return {
    ...document,
    chunks: texts.map((text, seq) => ({ seq, text })),
  };
}

function documentHits(
  hits: SearchHit[],
  filter: DocumentFilter,
): DocumentHits[] {
  const byPath = new Map<string, DocumentHits>();

  for (const hit of hits) {
    addHit(byPath, hit, filter);
  }

  return [...byPath.values()].slice(0, filter.limit);
}

/** The hits a context section reads: those within RELEVANCE_FLOOR of the best document hit; a search answers every hit. */
function relevantHits(hits: SearchHit[], docsSourceId: string): SearchHit[] {
  const floor = RELEVANCE_FLOOR * bestDocumentScore(hits, docsSourceId);

  return hits.filter((hit) => hit.score >= floor);
}

/** The best score of any document hit of the docs source, whatever its content type, so a section of weak ADRs is not judged against its own best. */
function bestDocumentScore(hits: SearchHit[], docsSourceId: string): number {
  return Math.max(
    0,
    ...hits
      .filter((hit) => docPathIn(hit, docsSourceId) !== null)
      .map((hit) => hit.score),
  );
}

function addHit(
  byPath: Map<string, DocumentHits>,
  hit: SearchHit,
  filter: DocumentFilter,
): void {
  const kept = keptDocument(hit, filter);

  if (!kept) {
    return;
  }
  const found = byPath.get(kept.path) ?? {
    ...kept,
    score: hit.score,
    chunks: [],
  };

  byPath.set(kept.path, found);
  found.chunks.push({ seq: hit.seq, text: withoutLocation(hit.text) });
}

/** The file and content type of a hit the section keeps: a `doc:<path>` document of the docs source, of a file the section's content types cover. */
function keptDocument(
  hit: SearchHit,
  filter: DocumentFilter,
): { path: string; contentType: string } | null {
  const path = docPathIn(hit, filter.docsSourceId);
  const contentType = path ? classifyFile(path) : null;

  return path && contentType && filter.types.has(contentType)
    ? { path, contentType }
    : null;
}

function docPathIn(hit: SearchHit, docsSourceId: string): string | null {
  return hit.sourceId === docsSourceId && hit.externalId
    ? docPathOf(hit.externalId)
    : null;
}

function toItem(document: DocumentHits): SourceItem {
  const texts = [...document.chunks]
    .sort((a, b) => a.seq - b.seq)
    .map((chunk) => chunk.text.trim());

  return mkItem([...new Set(texts)].join("\n"), {
    source_path: document.path,
    content_type: document.contentType,
    score: document.score,
  });
}
