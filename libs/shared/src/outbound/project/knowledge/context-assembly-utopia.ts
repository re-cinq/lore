// The Utopia arm of context assembly (specs/utopia-graph-mirror FR13): the `repo` and `adrs` sections read from a search over the whole documents pushed to the repo's `docs` source (specs, ADRs and every other markdown document), one item per document widened to the statements its hits were cut from, the `code` and `coupling` sections from the `test-coverage` source, the `memories` and `episodes` sections from the memory search, every other section left out of the block.

import { classifyFile } from "../../../domain/content-classify.js";
import { withoutLocation } from "../../../domain/utopia/docs/doc-text.js";
import {
  docPathOf,
  type SearchHit,
  type SearchPage,
  type StoredDocument,
} from "../../../domain/utopia/read-shapes.js";
import type { UtopiaReads } from "../../utopia/utopia-reads.js";
import type { SourceItem } from "./context-assembly-format.js";
import { mkItem, normalizeScores } from "./context-assembly-items.js";
import { codeQueryOf, queryTerms } from "./context-assembly-query-terms.js";
import { widenedChunks } from "./context-assembly-utopia-sections.js";
import {
  memorySectionReader,
  type UtopiaMemoryRead,
} from "./context-assembly-utopia-memory.js";
import {
  COVERAGE_SECTIONS,
  coverageItems,
} from "./context-assembly-utopia-coverage.js";
import type { SectionReader } from "./context-assembly-types.js";

/** Where a repository's mirror lives: its knowledge base and the `docs` source its documents were pushed to (`settings.utopia`). */
export interface UtopiaMirror {
  kbId: string;
  docsSourceId: string;
  /** The stored `test-coverage` source behind the `code` and `coupling` sections; without it they answer disabled. */
  coverageSourceId?: string;
}

/** What the Utopia arm reads with; absent when the deployment has no reader or the repository no mirror. */
export interface UtopiaArm extends UtopiaMirror {
  reads: UtopiaReads;
  /** The memory search behind the `memories` and `episodes` sections; without it they say there is no reader. */
  memories?: UtopiaMemoryRead;
}

const PAGE_SIZE = 50;

/** What each section Utopia answers keeps: Lore's content types (`classifyFile`), and fewer documents than Lore's limits, since an eval answer used Utopia's 4th and 5th spec 3 times in 65 and its 3rd ADR or later never (2026-11-01, 40 questions). */
const SECTIONS: Partial<
  Record<string, { types: ReadonlySet<string>; limit: number }>
> = {
  repo: { types: new Set(["spec", "doc"]), limit: 3 },
  adrs: { types: new Set(["adr"]), limit: 2 },
};

/** The arm when both halves are there, else null: the caller then answers with no sections. */
export function utopiaArmOf(
  reads: UtopiaReads | null | undefined,
  mirror: UtopiaMirror | undefined,
  memories?: UtopiaMemoryRead,
): UtopiaArm | null {
  return reads && mirror ? { reads, ...mirror, memories } : null;
}

/** One assembly's reader: every section shares one search, and a second page is asked for only by a section the first left short. */
export function utopiaSectionReader(
  arm: UtopiaArm,
  query: string,
): SectionReader {
  const terms = queryTerms(query);
  const docs = docsSectionReader(arm, query, codeQueryOf(terms));
  const memorySection = memorySectionReader(arm.memories, query, terms);

  return (section) => memorySection(section.source) ?? docs(section);
}

/** The `code` section searches by the files and symbols the ticket names when it names any (FR13.9): a ticket's prose ranks spec statements, and the `code:` items it needs stand nowhere near its top 100; every other section reads the ticket's own search. */
function docsSectionReader(
  arm: UtopiaArm,
  query: string,
  codeQuery: string | null,
): SectionReader {
  const page = searchPages(arm, query);
  const codePage = codeQuery ? searchPages(arm, codeQuery) : page;
  const stored = storedDocuments(arm);

  return async ({ source }) => {
    const read = hitsReader(arm, source, stored);

    if (!read) {
      return { sources: [], status: "disabled" };
    }
    const sources = await sectionDocuments(
      source === "code" ? codePage : page,
      read,
    );

    return { sources, status: sources.length > 0 ? "ok" : "empty" };
  };
}

function hitsReader(
  arm: UtopiaArm,
  source: string,
  stored: (path: string) => Promise<StoredDocument | null>,
): HitsReader | null {
  const docs = SECTIONS[source];

  return docs
    ? {
        itemsOf: (hits) =>
          widenedDocuments(
            hits,
            { docsSourceId: arm.docsSourceId, ...docs },
            stored,
          ),
        limit: docs.limit,
        eager: false,
      }
    : coverageReader(arm, source);
}

function coverageReader(arm: UtopiaArm, source: string): HitsReader | null {
  const coverage = COVERAGE_SECTIONS[source];
  const sourceId = arm.coverageSourceId;

  return coverage && sourceId
    ? {
        itemsOf: async (hits) => coverageItems(hits, sourceId, coverage),
        limit: coverage.limit,
        eager: true,
      }
    : null;
}

interface HitsReader {
  itemsOf: (hits: SearchHit[]) => Promise<SourceItem[]>;
  limit: number;
  /** Whether the second page is asked for together with the first: a coverage section's hits are rare among a search's documents, so it needs both nearly every time, and waiting for the first before asking is a second search's latency for nothing. */
  eager: boolean;
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

/** Each stored document of the docs source read once per assembly however many sections widen their hits from it; a read that fails leaves the hits as they came. */
function storedDocuments(
  arm: UtopiaArm,
): (path: string) => Promise<StoredDocument | null> {
  const documents = new Map<string, Promise<StoredDocument | null>>();
  const { reads, kbId, docsSourceId } = arm;

  return (path) => {
    const started =
      documents.get(path) ??
      reads
        .documentByExternalId(kbId, docsSourceId, `doc:${path}`)
        .catch(() => null);

    documents.set(path, started);

    return started;
  };
}

/** The first page's documents, or both pages' when the first left the section short and Utopia has more; an eager reader has the second page on its way before the first answers. */
async function sectionDocuments(
  page: (index: number) => Promise<SearchPage>,
  { itemsOf, limit, eager }: HitsReader,
): Promise<SourceItem[]> {
  const firstPage = page(0);
  const secondPage = eager ? page(1).catch(() => null) : null;
  const first = await firstPage;
  const documents = await itemsOf(first.hits);

  if (!first.hasMore || documents.length >= limit) {
    return documents;
  }
  const second = (await secondPage) ?? (await page(1));

  return itemsOf([...first.hits, ...second.hits]);
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
  return normalizeScores(documentHits(hits, filter).map(toItem));
}

/** The same documents, each hit widened to the statement it was cut from in the stored document (FR13.10); a document Utopia no longer holds keeps its chunks. */
async function widenedDocuments(
  hits: SearchHit[],
  filter: DocumentFilter,
  stored: (path: string) => Promise<StoredDocument | null>,
): Promise<SourceItem[]> {
  const documents = await Promise.all(
    documentHits(hits, filter).map(async (document) => {
      const whole = await stored(document.path);

      return whole ? widened(document, whole.content) : document;
    }),
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
