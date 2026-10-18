import { describe, it, expect } from "vitest";
import { docStatementItems } from "../../../domain/utopia/doc-statements.js";
import { wireBody } from "../../../domain/utopia/statements.js";
import type {
  SearchHit,
  SearchPage,
} from "../../../domain/utopia/read-shapes.js";
import type { SearchWindow, UtopiaReads } from "../../utopia/utopia-reads.js";
import {
  utopiaDocuments,
  utopiaSectionReader,
} from "./context-assembly-utopia.js";

const STATEMENTS = "9e8d7c6b-5a49-4382-b1a0-f9e8d7c6b533";
const SPEC = "specs/utopia-graph-mirror/spec.md";

function pushedChunks(
  path: string,
  kind: "spec" | "adr",
  content: string,
): Map<string, string> {
  return new Map(
    docStatementItems({
      repo: "re-cinq/lore",
      path,
      content,
      commit: "fb53a29",
      kind,
    }).map((pushed) => [
      pushed.externalId,
      JSON.stringify(wireBody(pushed), null, 2),
    ]),
  );
}

const specChunks = pushedChunks(
  SPEC,
  "spec",
  "# Utopia graph mirror\n\n## Reads\n\nA 404 reads as no document.\n\nA search page carries its hits in rank order.\n\nThe second page starts at offset 50.\n\nA hit past offset 100 is refused.\n",
);

const EVALS_SPEC = "specs/context-evals/spec.md";
const evalsChunks = pushedChunks(
  EVALS_SPEC,
  "spec",
  "# Context evals\n\nA question is written from each document.\n",
);

function hit(
  externalId: string,
  chunks: Map<string, string>,
  score: number,
  sourceId = STATEMENTS,
): SearchHit {
  return {
    chunkId: `chunk-${externalId}`,
    documentId: `document-${externalId}`,
    seq: 0,
    text: chunks.get(externalId) ?? "",
    filename: externalId,
    sourceId,
    externalId,
    score,
    bm25Rank: 1,
    vectorRank: null,
  };
}

const REPO_FILTER = {
  statementsSourceId: STATEMENTS,
  types: new Set(["spec", "doc"]),
  limit: 5,
};

describe("utopiaDocuments", () => {
  it("groups three stmt chunks of one spec into one item in ordinal order", () => {
    const hits = [
      hit(`stmt:${SPEC}#0002`, specChunks, 0.032),
      hit(`stmt:${SPEC}#0000`, specChunks, 0.03),
      hit(`stmt:${SPEC}#0001`, specChunks, 0.029),
    ];

    expect(utopiaDocuments(hits, REPO_FILTER)).toEqual([
      {
        text: "A 404 reads as no document.\nA search page carries its hits in rank order.\nThe second page starts at offset 50.",
        tokens: 28,
        source_path: SPEC,
        content_type: "spec",
        score: 1,
      },
    ]);
  });

  it("keeps the three best-scoring of a spec's four statements, in the order they stand in it", () => {
    const hits = [
      hit(`stmt:${SPEC}#0003`, specChunks, 0.032),
      hit(`stmt:${SPEC}#0001`, specChunks, 0.031),
      hit(`stmt:${SPEC}#0000`, specChunks, 0.03),
      hit(`stmt:${SPEC}#0002`, specChunks, 0.016),
    ];

    expect(utopiaDocuments(hits, REPO_FILTER)[0]?.text).toEqual(
      "A 404 reads as no document.\nA search page carries its hits in rank order.\nA hit past offset 100 is refused.",
    );
  });

  it("scores the spec whose best hit is 0.032 at 1 and the one whose best is 0.016 at 0.5", () => {
    const hits = [
      hit(`stmt:${SPEC}#0000`, specChunks, 0.032),
      hit(`stmt:${EVALS_SPEC}#0000`, evalsChunks, 0.016),
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

  it("drops hits from another source_id", () => {
    const hits = [
      hit(`stmt:${SPEC}#0000`, specChunks, 0.032, "a-test-runs-source"),
      hit(`doc:${SPEC}`, specChunks, 0.03),
    ];

    expect(utopiaDocuments(hits, REPO_FILTER)).toEqual([
      {
        text: "Utopia graph mirror",
        tokens: 5,
        source_path: SPEC,
        content_type: "spec",
        score: 1,
      },
    ]);
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
const adrChunks = pushedChunks(
  ADR,
  "adr",
  "# ADR-052: Code-to-spec graph mirrored in Utopia\n\nEvery spec and ADR is pushed to Utopia.\n",
);

const SPEC_THEN_ADR = [
  ...Array.from({ length: 50 }, () =>
    hit(`stmt:${SPEC}#0000`, specChunks, 0.03),
  ),
  hit(`stmt:${ADR}#0000`, adrChunks, 0.01),
];

const STATEMENT_ITEMS = {
  sourceId: STATEMENTS,
  externalIdPrefixes: ["doc:", "stmt:"],
};

describe("utopiaSectionReader", () => {
  it("searches only the doc: and stmt: items of the statements source, fetching a second page at offset 50 only when hasMore and adrs is under its limit", async () => {
    const windows: SearchWindow[] = [];
    const read = utopiaSectionReader(
      {
        reads: searchOver(SPEC_THEN_ADR, windows),
        kbId: "kb-1",
        statementsSourceId: STATEMENTS,
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
        { topK: 50, offset: 0, scope: STATEMENT_ITEMS },
        { topK: 50, offset: 50, scope: STATEMENT_ITEMS },
      ],
      repo: [SPEC],
      adrs: [ADR],
    });
  });

  it("answers code: no Utopia reader yet for the code section", async () => {
    const windows: SearchWindow[] = [];
    const read = utopiaSectionReader(
      {
        reads: searchOver(SPEC_THEN_ADR, windows),
        kbId: "kb-1",
        statementsSourceId: STATEMENTS,
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
      code: {
        sources: [{ text: "code: no Utopia reader yet", tokens: 7 }],
        status: "ok",
      },
      windows: [],
    });
  });
});
