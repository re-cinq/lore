// The Utopia arm of context assembly (specs/utopia-graph-mirror FR13): the `repo` and `adrs` sections read from a search over the whole documents pushed to the repo's `docs` source (specs, ADRs and every other markdown document), one item per document widened to the statements its hits were cut from, the `code` and `coupling` sections from the `test-coverage` source, the `memories` and `episodes` sections from the memory search, every other section left out of the block.

import type {
  SearchHit,
  SearchPage,
  StoredDocument,
} from "../../../domain/utopia/read-shapes.js";
import type { UtopiaReads } from "../../utopia/utopia-reads.js";
import type { SourceItem } from "./context-assembly-format.js";
import {
  areaCount,
  codeQueryOf,
  fileNamesOf,
  queryTerms,
} from "./context-assembly-query-terms.js";
import {
  bothPages,
  historySection,
} from "./context-assembly-utopia-history.js";
import { storedDocuments } from "./context-assembly-utopia-sections.js";
import { widenedDocuments } from "./context-assembly-utopia-documents.js";
import {
  memorySectionReader,
  type UtopiaMemoryRead,
} from "./context-assembly-utopia-memory.js";
import {
  COVERAGE_SECTIONS,
  coverageItems,
} from "./context-assembly-utopia-coverage.js";
import type { SectionReader } from "./context-assembly-types.js";
import {
  memoizedFiles,
  type RepoFiles,
} from "./context-assembly-utopia-bodies.js";

/** Where a repository's mirror lives: its knowledge base and the `docs` source its documents were pushed to (`settings.utopia`). */
export interface UtopiaMirror {
  kbId: string;
  docsSourceId: string;
  /** The stored `test-coverage` source behind the `code` and `coupling` sections; without it they answer disabled. */
  coverageSourceId?: string;
  /** The `git-history` source behind the `history` section; without it the section answers disabled. */
  historySourceId?: string;
}

/** What the Utopia arm reads with; absent when the deployment has no reader or the repository no mirror. */
export interface UtopiaArm extends UtopiaMirror {
  reads: UtopiaReads;
  /** The memory search behind the `memories` and `episodes` sections; without it they say there is no reader. */
  memories?: UtopiaMemoryRead;
  /** The repository's files, which finish a coupling item with the test and covered lines it cites (FR13.8b); without them the item names its lines only. */
  files?: RepoFiles;
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
  files?: RepoFiles,
): UtopiaArm | null {
  return reads && mirror ? { reads, ...mirror, memories, files } : null;
}

/** One assembly's reader: every section shares one search, and a second page is asked for only by a section the first left short. */
export function utopiaSectionReader(
  arm: UtopiaArm,
  query: string,
): SectionReader {
  const terms = queryTerms(query);
  const docs = docsSectionReader(arm, query, {
    codeQuery: codeQueryOf(terms),
    areas: areaCount(terms),
  });
  const memorySection = memorySectionReader(arm.memories, query, terms);

  return (section) =>
    section.source === "history"
      ? historySection(historySearch(arm), fileNamesOf(terms))
      : (memorySection(section.source) ?? docs(section));
}

function historySearch(arm: UtopiaArm) {
  const sourceId = arm.historySourceId;

  return sourceId
    ? {
        sourceId,
        pages: (query: string) => bothPages(searchPages(arm, query)),
        whole: storedText(arm, sourceId),
      }
    : null;
}

/** A stored document's text in one source, or null when Utopia holds none or the read fails. */
function storedText(
  { reads, kbId }: UtopiaArm,
  sourceId: string,
): (externalId: string) => Promise<string | null> {
  return async (externalId) => {
    const stored = await reads
      .documentByExternalId(kbId, sourceId, externalId)
      .catch(() => null);

    return stored?.content ?? null;
  };
}

/** The `code` section searches by the files and symbols the ticket names when it names any (FR13.9): a ticket's prose ranks spec statements, and the `code:` items it needs stand nowhere near its top 100; every other section reads the ticket's own search. */
function docsSectionReader(
  arm: UtopiaArm,
  query: string,
  { codeQuery, areas }: { codeQuery: string | null; areas: number },
): SectionReader {
  const page = searchPages(arm, query);
  const codePage = codeQuery ? searchPages(arm, codeQuery) : page;
  const stores = storesOf(arm);

  return async ({ source }) => {
    const read = hitsReader(arm, { source, areas }, stores);

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

/** What a section's items are finished from, each read once per assembly: the docs source's stored documents, and the repository's files when the arm has them. */
interface Stores {
  stored: (path: string) => Promise<StoredDocument | null>;
  files: RepoFiles | undefined;
}

function storesOf(arm: UtopiaArm): Stores {
  return {
    stored: storedDocuments(arm),
    files: arm.files ? memoizedFiles(arm.files) : undefined,
  };
}

function hitsReader(
  arm: UtopiaArm,
  { source, areas }: { source: string; areas: number },
  { stored, files }: Stores,
): HitsReader | null {
  const docs = SECTIONS[source];

  if (!docs) {
    return coverageReader(arm, source, files);
  }
  const limit = scopedLimit(docs.limit, areas);
  const filter = { docsSourceId: arm.docsSourceId, types: docs.types, limit };

  return {
    itemsOf: (hits) => widenedDocuments(hits, filter, stored),
    limit,
    eager: false,
  };
}

/** A ticket naming several places gets room for each: one more document per place past the first, up to twice the section's limit. */
function scopedLimit(limit: number, areas: number): number {
  return limit + Math.min(limit, Math.max(0, areas - 1));
}

function coverageReader(
  arm: UtopiaArm,
  source: string,
  files: RepoFiles | undefined,
): HitsReader | null {
  const coverage = COVERAGE_SECTIONS[source];
  const sourceId = arm.coverageSourceId;

  return coverage && sourceId
    ? {
        itemsOf: (hits) => coverageItems(hits, sourceId, coverage, files),
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
