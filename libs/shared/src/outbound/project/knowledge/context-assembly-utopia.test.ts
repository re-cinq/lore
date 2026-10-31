import { describe, it, expect } from "vitest";
import { docDocument } from "../../../domain/utopia/docs/doc-text.js";
import type {
  SearchHit,
  SearchPage,
} from "../../../domain/utopia/read-shapes.js";
import type { SearchWindow, UtopiaReads } from "../../utopia/utopia-reads.js";
import {
  utopiaDocuments,
  utopiaSectionReader,
} from "./context-assembly-utopia.js";
import type { UtopiaMemoryRead } from "./context-assembly-utopia-memory.js";

const DOCS = "9e8d7c6b-5a49-4382-b1a0-f9e8d7c6b533";
const SPEC = "specs/utopia-graph-mirror/spec.md";
const EVALS_SPEC = "specs/context-evals/spec.md";

function firstChunk(
  path: string,
  kind: "spec" | "adr" | "doc",
  file: string,
): string {
  return docDocument({ repo: "re-cinq/lore", path, content: file, kind })
    .content as string;
}

function hit(
  externalId: string,
  text: string,
  score: number,
  options: { seq?: number; sourceId?: string } = {},
): SearchHit {
  return {
    chunkId: `chunk-${externalId}-${options.seq ?? 0}`,
    documentId: `document-${externalId}`,
    seq: options.seq ?? 0,
    text,
    filename: externalId,
    sourceId: options.sourceId ?? DOCS,
    externalId,
    score,
    bm25Rank: 1,
    vectorRank: null,
  };
}

const REPO_FILTER = {
  docsSourceId: DOCS,
  types: new Set(["spec", "doc"]),
  limit: 5,
};

const specFirst = firstChunk(
  SPEC,
  "spec",
  "# Utopia graph mirror\n\nA 404 reads as no document.",
);

describe("utopiaDocuments", () => {
  it("joins three chunks of one spec into one item in the order they stand in the file, the location lines of the first dropped", () => {
    const hits = [
      hit(`doc:${SPEC}`, "The second page starts at offset 50.", 0.032, {
        seq: 2,
      }),
      hit(`doc:${SPEC}`, specFirst, 0.03, { seq: 0 }),
      hit(
        `doc:${SPEC}`,
        "A search page carries its hits in rank order.",
        0.029,
        { seq: 1 },
      ),
    ];

    expect(utopiaDocuments(hits, REPO_FILTER)).toMatchObject([
      {
        text: "# Utopia graph mirror\n\nA 404 reads as no document.\nA search page carries its hits in rank order.\nThe second page starts at offset 50.",
        source_path: SPEC,
        content_type: "spec",
        score: 1,
      },
    ]);
  });

  it("scores the spec whose best hit is 0.032 at 1 and the one whose best is 0.016 at 0.5", () => {
    const hits = [
      hit(`doc:${SPEC}`, specFirst, 0.032),
      hit(
        `doc:${EVALS_SPEC}`,
        firstChunk(EVALS_SPEC, "spec", "# Context evals"),
        0.016,
      ),
    ];

    expect(
      utopiaDocuments(hits, REPO_FILTER).map(({ source_path, score }) => ({
        source_path,
        score,
      })),
    ).toEqual([
      { source_path: SPEC, score: 1 },
      { source_path: EVALS_SPEC, score: 0.5 },
    ]);
  });

  it("renders README.md's chunk as one doc item whose text starts at the file", () => {
    const hits = [
      hit(
        "doc:README.md",
        firstChunk("README.md", "doc", "# Lore\n\nRun install.sh once."),
        0.032,
      ),
    ];

    expect(utopiaDocuments(hits, REPO_FILTER)).toMatchObject([
      {
        text: "# Lore\n\nRun install.sh once.",
        source_path: "README.md",
        content_type: "doc",
        score: 1,
      },
    ]);
  });

  it("drops hits from another source_id and items of the docs source that are no doc: document", () => {
    const hits = [
      hit(`doc:${SPEC}`, specFirst, 0.032, { sourceId: "a-test-runs-source" }),
      hit(`stmt:${SPEC}#0000`, '{"external_id":"stmt:x"}', 0.03),
      hit(`doc:${EVALS_SPEC}`, firstChunk(EVALS_SPEC, "spec", "Kept."), 0.02),
    ];

    expect(
      utopiaDocuments(hits, REPO_FILTER).map(
        (document) => document.source_path,
      ),
    ).toEqual([EVALS_SPEC]);
  });
});

function searchOver(
  hits: SearchHit[],
  windows: SearchWindow[] = [],
): UtopiaReads {
  return {
    search: async (_kbId, _q, window): Promise<SearchPage> => {
      windows.push(window);

      return {
        hits: hits.slice(window.offset, window.offset + window.topK),
        hasMore: hits.length > window.offset + window.topK,
        vectorUsed: true,
      };
    },
    documentByExternalId: async () => null,
  };
}

const ADR = "adrs/ADR-052-code-to-spec-graph-mirrored-in-utopia.md";
const SPEC_THEN_ADR = [
  ...Array.from({ length: 50 }, () => hit(`doc:${SPEC}`, specFirst, 0.03)),
  hit(
    `doc:${ADR}`,
    firstChunk(ADR, "adr", "# ADR-052: Code-to-spec graph mirrored in Utopia"),
    0.01,
  ),
];

describe("utopiaSectionReader", () => {
  it("fetches a second page at offset 50 only when hasMore and adrs is under its limit", async () => {
    const windows: SearchWindow[] = [];
    const read = utopiaSectionReader(
      {
        reads: searchOver(SPEC_THEN_ADR, windows),
        kbId: "kb-1",
        docsSourceId: DOCS,
      },
      "how are ADRs mirrored",
    );

    const repo = await read({
      header: "Conventions",
      source: "repo",
      priority: 1,
    });
    const windowsForRepo = windows.length;
    const adrs = await read({
      header: "Architecture Decisions",
      source: "adrs",
      priority: 2,
    });

    expect({
      windowsForRepo,
      windows,
      repo: repo.sources.map((document) => document.source_path),
      adrs: adrs.sources.map((document) => document.source_path),
    }).toEqual({
      windowsForRepo: 2,
      windows: [
        { topK: 50, offset: 0 },
        { topK: 50, offset: 50 },
      ],
      repo: [SPEC],
      adrs: [ADR],
    });
  });

  it("leaves the code section out and asks Utopia nothing", async () => {
    const windows: SearchWindow[] = [];
    const read = utopiaSectionReader(
      {
        reads: searchOver(SPEC_THEN_ADR, windows),
        kbId: "kb-1",
        docsSourceId: DOCS,
      },
      "chunk search",
    );

    expect({
      code: await read({
        header: "Relevant Code",
        source: "code",
        priority: 2,
      }),
      windows,
    }).toEqual({
      code: { sources: [], status: "disabled" },
      windows: [],
    });
  });
});

describe("utopiaSectionReader memories and episodes", () => {
  const memoryHit = (
    source: "memory" | "episode",
    key: string,
    score: number,
  ) => ({
    key,
    value: `${key} text`,
    score,
    agent_id: "a",
    source,
    backend: "utopia" as const,
  });
  const noSearch: UtopiaReads = {
    async search() {
      return { hits: [], hasMore: false, vectorUsed: true };
    },
    async documentByExternalId() {
      return null;
    },
  };
  const armWith = (memories?: UtopiaMemoryRead) => ({
    reads: noSearch,
    kbId: "kb",
    docsSourceId: DOCS,
    memories,
  });
  const section = (source: string) =>
    ({
      source,
    }) as Parameters<ReturnType<typeof utopiaSectionReader>>[0];

  it("fills memories with the memory hit and episodes with the episode hit of one search for 'deploy'", async () => {
    const asked: [string, number][] = [];
    const reader = utopiaSectionReader(
      armWith(async (query, limit) => {
        asked.push([query, limit]);

        return [
          memoryHit("memory", "note", 1),
          memoryHit("episode", "episode-7", 0.5),
        ];
      }),
      "deploy",
    );
    const [memories, episodes] = await Promise.all([
      reader(section("memories")),
      reader(section("episodes")),
    ]);

    expect({
      asked,
      memories: memories.sources.map(({ text, source_path }) => ({
        text,
        source_path,
      })),
      episodes: episodes.sources.map(({ text, content_type }) => ({
        text,
        content_type,
      })),
      statuses: [memories.status, episodes.status],
    }).toEqual({
      asked: [["deploy", 30]],
      memories: [{ text: "**note** (memory): note text", source_path: "note" }],
      episodes: [
        { text: "**episode-7**: episode-7 text", content_type: "episode" },
      ],
      statuses: ["ok", "ok"],
    });
  });

  it("answers disabled for memories when the arm has no memory search", async () => {
    expect(
      await utopiaSectionReader(armWith(), "deploy")(section("memories")),
    ).toEqual({
      sources: [],
      status: "disabled",
    });
  });

  it("answers disabled for episodes when no base holds a memory source", async () => {
    const reader = utopiaSectionReader(
      armWith(async () => null),
      "deploy",
    );

    expect(await reader(section("episodes"))).toEqual({
      sources: [],
      status: "disabled",
    });
  });

  it("answers empty for episodes when the search found memories only", async () => {
    const reader = utopiaSectionReader(
      armWith(async () => [memoryHit("memory", "note", 1)]),
      "deploy",
    );

    expect(await reader(section("episodes"))).toEqual({
      sources: [],
      status: "empty",
    });
  });
});
