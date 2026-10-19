// The Utopia arm of context assembly (specs/utopia-graph-mirror FR13): the `repo` and `adrs` sections read from a search over the statements the spec/ADR mirror pushed, one item per document, every other section still saying it has no Utopia reader.

import { classifyFile } from "../../../domain/content-classify.js";
import { noUtopiaReader } from "../../../domain/knowledge-backend.js";
import {
  parseStatementsChunk,
  pushedPathOf,
  statementTexts,
  type SearchHit,
  type PushedPath,
  type SearchPage,
  type StatementsChunk,
} from "../../../domain/utopia/read-shapes.js";
import type { UtopiaReads } from "../../utopia/utopia-reads.js";
import {
  CHUNKS_PER_DOCUMENT,
  type SourceItem,
} from "./context-assembly-format.js";
import { ITEM_LIMITS } from "./context-assembly-fetchers-content.js";
import { mkItem, normalizeScores } from "./context-assembly-items.js";
import type { SectionReader } from "./context-assembly-types.js";

/** Where a repository's mirror lives: its knowledge base and the source its statements were pushed to (`settings.utopia`). */
export interface UtopiaMirror {
  kbId: string;
  statementsSourceId: string;
}

/** What the Utopia arm reads with; absent when the deployment has no reader or the repository no mirror. */
export interface UtopiaArm extends UtopiaMirror {
  reads: UtopiaReads;
}

const PAGE_SIZE = 50;

// Every section reads spec and ADR items: code, tests, commits and tracker items share the source and would take the window's places.
const STATEMENT_ITEM_PREFIXES = ["doc:", "stmt:"];

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
    const filter = { statementsSourceId: arm.statementsSourceId, ...section };
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
      scope: {
        sourceId: arm.statementsSourceId,
        externalIdPrefixes: STATEMENT_ITEM_PREFIXES,
      },
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
  statementsSourceId: string;
  types: ReadonlySet<string>;
  limit: number;
}

interface DocumentHits {
  path: string;
  contentType: string;
  score: number;
  parts: { ordinal: number; score: number; texts: string[] }[];
}

/** The documents the hits name, one item each in the rank of its best hit, scored so the best is 1 as Lore's are: the statements source's doc and statement chunks only, a document's best few in the order they stand in it, its title first. */
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
  const kept = keptHit(hit, filter);

  if (!kept) {
    return;
  }
  const found = byPath.get(kept.path) ?? {
    path: kept.path,
    contentType: kept.contentType,
    score: hit.score,
    parts: [],
  };

  byPath.set(kept.path, found);
  found.parts.push(kept);
}

interface KeptHit {
  path: string;
  contentType: string;
  ordinal: number;
  score: number;
  texts: string[];
}

/** A hit the section keeps: a doc or statement item of the statements source, of a file the section's content types cover. */
function keptHit(hit: SearchHit, filter: DocumentFilter): KeptHit | null {
  const pushed = pushedItemOf(hit, filter.statementsSourceId);
  const contentType = pushed ? classifyFile(pushed.path) : null;

  return pushed && contentType && filter.types.has(contentType)
    ? {
        path: pushed.path,
        contentType,
        ordinal: pushed.ordinal ?? -1,
        score: hit.score,
        texts: partTexts(pushed.kind, parseStatementsChunk(hit.text)),
      }
    : null;
}

type PushedItem = PushedPath & { kind: "doc" | "stmt" };

function pushedItemOf(
  hit: SearchHit,
  statementsSourceId: string,
): PushedItem | null {
  const pushed =
    hit.sourceId === statementsSourceId && hit.externalId
      ? pushedPathOf(hit.externalId)
      : null;

  return isDocOrStatement(pushed) ? pushed : null;
}

function isDocOrStatement(pushed: PushedPath | null): pushed is PushedItem {
  return pushed?.kind === "doc" || pushed?.kind === "stmt";
}

/** A doc item gives the document's title; a statement item its text. A chunk cut mid-item gives nothing, and its document still counts. */
function partTexts(
  kind: "doc" | "stmt",
  chunk: StatementsChunk | null,
): string[] {
  if (!chunk) {
    return [];
  }

  return kind === "doc" ? documentTitles(chunk) : statementTexts(chunk);
}

function documentTitles(chunk: StatementsChunk): string[] {
  const documentEntities = chunk.e.filter(
    ([, kindWord]) => kindWord === "Spec" || kindWord === "Adr",
  );
  const documents = new Set(documentEntities.map(([name]) => name));

  return chunk.s.flatMap(([, subject, phrase, , value]) =>
    phrase === "title" && documents.has(subject) && value !== null
      ? [value]
      : [],
  );
}

function toItem(document: DocumentHits): SourceItem {
  const texts = [...document.parts]
    .sort((a, b) => b.score - a.score)
    .slice(0, CHUNKS_PER_DOCUMENT)
    .sort((a, b) => a.ordinal - b.ordinal)
    .flatMap((part) => part.texts);

  return mkItem([...new Set(texts)].join("\n"), {
    source_path: document.path,
    content_type: document.contentType,
    score: document.score,
  });
}
