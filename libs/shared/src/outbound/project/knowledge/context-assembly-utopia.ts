// The Utopia arm of context assembly (specs/utopia-graph-mirror FR13): the `repo` and `adrs` sections read from a search over the whole documents pushed to the repo's `docs` source (specs, ADRs and every other markdown document), one item per document, every other section still saying it has no Utopia reader.

import { classifyFile } from "../../../domain/content-classify.js";
import { noUtopiaReader } from "../../../domain/knowledge-backend.js";
import { withoutLocation } from "../../../domain/utopia/docs/doc-text.js";
import {
  docPathOf,
  type SearchHit,
  type SearchPage,
} from "../../../domain/utopia/read-shapes.js";
import type { UtopiaReads } from "../../utopia/utopia-reads.js";
import type { SourceItem } from "./context-assembly-format.js";
import { ITEM_LIMITS } from "./context-assembly-fetchers-content.js";
import { mkItem, normalizeScores } from "./context-assembly-items.js";
import type { SectionReader } from "./context-assembly-types.js";

/** Where a repository's mirror lives: its knowledge base and the `docs` source its documents were pushed to (`settings.utopia`). */
export interface UtopiaMirror {
  kbId: string;
  docsSourceId: string;
}

/** What the Utopia arm reads with; absent when the deployment has no reader or the repository no mirror. */
export interface UtopiaArm extends UtopiaMirror {
  reads: UtopiaReads;
}

const PAGE_SIZE = 50;

/** What each section Utopia answers keeps: Lore's content types (`classifyFile`) and Lore's item limit. */
const SECTIONS: Partial<
  Record<string, { types: ReadonlySet<string>; limit: number }>
> = {
  repo: { types: new Set(["spec", "doc"]), limit: ITEM_LIMITS.repo },
  adrs: { types: new Set(["adr"]), limit: ITEM_LIMITS.adrs },
};

/** The arm when both halves are there, else null: the caller then answers with no-reader sections. */
export function utopiaArmOf(
  reads: UtopiaReads | null | undefined,
  mirror: UtopiaMirror | undefined,
): UtopiaArm | null {
  return reads && mirror ? { reads, ...mirror } : null;
}

/** One assembly's reader: every section shares one search, and a second page is asked for only by a section the first left short. */
export function utopiaSectionReader(
  arm: UtopiaArm,
  query: string,
): SectionReader {
  const page = searchPages(arm, query);

  return async ({ source }) => {
    const section = SECTIONS[source];

    if (!section) {
      return { sources: [mkItem(noUtopiaReader(source))], status: "ok" };
    }
    const filter = { docsSourceId: arm.docsSourceId, ...section };
    const sources = await sectionDocuments(
      page,
      (hits) => utopiaDocuments(hits, filter),
      filter.limit,
    );

    return { sources, status: sources.length > 0 ? "ok" : "empty" };
  };
}

/** The search's pages, each asked for once however many sections read it; Utopia refuses a window past 100, so there are two. */
function searchPages(
  arm: UtopiaArm,
  query: string,
): (index: number) => Promise<SearchPage> {
  const pages: Promise<SearchPage>[] = [];

  return (index) =>
    (pages[index] ??= arm.reads.search(arm.kbId, query, {
      topK: PAGE_SIZE,
      offset: index * PAGE_SIZE,
    }));
}

/** The first page's documents, or both pages' when the first left the section short and Utopia has more. */
async function sectionDocuments(
  page: (index: number) => Promise<SearchPage>,
  documentsOf: (hits: SearchHit[]) => SourceItem[],
  limit: number,
): Promise<SourceItem[]> {
  const first = await page(0);
  const documents = documentsOf(first.hits);

  if (!first.hasMore || documents.length >= limit) {
    return documents;
  }

  return documentsOf([...first.hits, ...(await page(1)).hits]);
}

interface DocumentFilter {
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
  const byPath = new Map<string, DocumentHits>();

  for (const hit of hits) {
    addHit(byPath, hit, filter);
  }

  return normalizeScores(
    [...byPath.values()].slice(0, filter.limit).map(toItem),
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
