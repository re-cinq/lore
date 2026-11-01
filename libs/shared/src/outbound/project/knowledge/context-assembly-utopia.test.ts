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
    0.025,
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
});

describe("utopiaSectionReader section limits", () => {
  const docHits = (paths: string[], kind: "spec" | "adr") =>
    paths.map((path, rank) =>
      hit(
        `doc:${path}`,
        firstChunk(path, kind, `# ${path}`),
        0.05 - rank / 1000,
      ),
    );
  const specs = ["a", "b", "c", "d", "e"].map(
    (name) => `specs/${name}/spec.md`,
  );
  const adrs = ["1", "2", "3"].map((n) => `adrs/ADR-00${n}-x.md`);
  const read = (source: "repo" | "adrs", query = "how are ADRs mirrored") =>
    utopiaSectionReader(
      {
        reads: searchOver([...docHits(specs, "spec"), ...docHits(adrs, "adr")]),
        kbId: "kb-1",
        docsSourceId: DOCS,
      },
      query,
    )({ header: source, source, priority: 1 });

  it("keeps specs a, b and c of five ranked spec hits under repo, and ADR-001 and ADR-002 of three under adrs", async () => {
    const [repo, adrSection] = await Promise.all([read("repo"), read("adrs")]);

    expect({
      repo: repo.sources.map((document) => document.source_path),
      adrs: adrSection.sources.map((document) => document.source_path),
    }).toEqual({ repo: specs.slice(0, 3), adrs: adrs.slice(0, 2) });
  });

  it("keeps no spec under repo when the best ADR hit is 0.05 and the specs score 0.03, under three quarters of it", async () => {
    const weakSpecs = specs.map((path) =>
      hit(`doc:${path}`, firstChunk(path, "spec", `# ${path}`), 0.03),
    );
    const repo = await utopiaSectionReader(
      {
        reads: searchOver([...docHits(adrs, "adr"), ...weakSpecs]),
        kbId: "kb-1",
        docsSourceId: DOCS,
      },
      "how are ADRs mirrored",
    )({ header: "repo", source: "repo", priority: 1 });

    expect(repo).toEqual({ sources: [], status: "empty" });
  });

  it("keeps all five specs under repo and all three ADRs under adrs when the ticket names files in three areas", async () => {
    const ticket =
      "Change apps/stations/src/work/tick.ts, libs/shared/src/domain/loop.ts and apps/web-ui/src/app/Board.tsx";
    const [repo, adrSection] = await Promise.all([
      read("repo", ticket),
      read("adrs", ticket),
    ]);

    expect({
      repo: repo.sources.map((document) => document.source_path),
      adrs: adrSection.sources.map((document) => document.source_path),
    }).toEqual({ repo: specs, adrs });
  });
});

describe("utopiaSectionReader code and coupling", () => {
  const COVERAGE = "c0c0c0c0-5a49";
  const FOOTER = "libs/shared/src/domain/pr-body.ts";
  const tuple = (rows: unknown[], entities: unknown[], id: string) =>
    JSON.stringify({ e: entities, s: rows, external_id: id });
  const attr = (subject: string, phrase: string, value: string) => [
    null,
    subject,
    phrase,
    null,
    value,
    {},
    null,
    null,
  ];
  const codeText = tuple(
    [
      attr("f", "path", FOOTER),
      [null, "f", "defines", "f#prFooter", null, {}, null, null],
      attr("f#prFooter", "symbol", "prFooter"),
      attr("f#prFooter", "line_start", "20"),
      attr("f#prFooter", "line_end", "31"),
    ],
    [["f", "SourceFile", true]],
    `code:${FOOTER}`,
  );
  const stmtText = tuple(
    [attr("s", "text", "A PR footer names its task.")],
    [["s", "Statement", true]],
    `stmt:${SPEC}#0146`,
  );
  const hits = [
    hit(`code:${FOOTER}`, codeText, 0.032, { sourceId: COVERAGE }),
    hit(`code:stale.ts`, codeText, 0.04, { sourceId: "test-coverage-unused" }),
    hit(`stmt:${SPEC}#0146`, stmtText, 0.016, { sourceId: COVERAGE }),
    hit(`doc:${SPEC}`, specFirst, 0.03),
  ];
  const read = utopiaSectionReader(
    {
      reads: searchOver(hits),
      kbId: "kb-1",
      docsSourceId: DOCS,
      coverageSourceId: COVERAGE,
    },
    "prFooter",
  );
  const section = (source: string) =>
    ({ source }) as Parameters<ReturnType<typeof utopiaSectionReader>>[0];

  it("fills code with libs/shared/src/domain/pr-body.ts and prFooter at L20-L31 from the code: hit of the coverage source, the set-aside copy's stale.ts left out", async () => {
    expect(await read(section("code"))).toMatchObject({
      status: "ok",
      sources: [
        {
          text: `${FOOTER}\n  defines prFooter (L20-L31)`,
          source_path: FOOTER,
          content_type: "code",
          score: 1,
        },
      ],
    });
  });

  it("fills coupling with the stmt: hit specs/utopia-graph-mirror/spec.md#0146 and its text, the doc: hit left out", async () => {
    expect(await read(section("coupling"))).toMatchObject({
      status: "ok",
      sources: [
        {
          text: `${SPEC}#0146: A PR footer names its task.`,
          source_path: `${SPEC}#0146`,
          content_type: "coupling",
          score: 1,
        },
      ],
    });
  });

  it("asks for both pages at once for code, the second window before the first page answers", async () => {
    const windows: SearchWindow[] = [];
    const eager = utopiaSectionReader(
      {
        reads: searchOver(hits, windows),
        kbId: "kb-1",
        docsSourceId: DOCS,
        coverageSourceId: COVERAGE,
      },
      "prFooter",
    );

    const reading = eager(section("code"));
    const windowsBeforeAnyAnswer = windows.length;

    await reading;

    expect({ windowsBeforeAnyAnswer, windows }).toEqual({
      windowsBeforeAnyAnswer: 2,
      windows: [
        { topK: 50, offset: 0 },
        { topK: 50, offset: 50 },
      ],
    });
  });

  it("leaves code out and asks Utopia nothing when the repo has no test-coverage source", async () => {
    const windows: SearchWindow[] = [];
    const bare = utopiaSectionReader(
      { reads: searchOver(hits, windows), kbId: "kb-1", docsSourceId: DOCS },
      "prFooter",
    );

    expect({ code: await bare(section("code")), windows }).toEqual({
      code: { sources: [], status: "disabled" },
      windows: [],
    });
  });

  it("answers empty for code when the search holds no code: hit", async () => {
    const none = utopiaSectionReader(
      {
        reads: searchOver([]),
        kbId: "kb-1",
        docsSourceId: DOCS,
        coverageSourceId: COVERAGE,
      },
      "prFooter",
    );

    expect(await none(section("code"))).toEqual({
      sources: [],
      status: "empty",
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

  it("fills memories with the deployNote memory hit and episodes with the episode hit of one search for 'deploy with deployNote'", async () => {
    const asked: [string, number][] = [];
    const reader = utopiaSectionReader(
      armWith(async (query, limit) => {
        asked.push([query, limit]);

        return [
          memoryHit("memory", "deployNote", 1),
          memoryHit("episode", "deployNote-7", 0.5),
        ];
      }),
      "deploy with deployNote",
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
      asked: [["deploy with deployNote", 30]],
      memories: [
        {
          text: "**deployNote** (memory): deployNote text",
          source_path: "deployNote",
        },
      ],
      episodes: [
        {
          text: "**deployNote-7**: deployNote-7 text",
          content_type: "episode",
        },
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

describe("utopiaSectionReader code search by the ticket's names (FR13.9)", () => {
  const COVERAGE = "c0c0c0c0-5a49";
  const FOOTER = "libs/shared/src/domain/pr-body.ts";
  const codeText = JSON.stringify({
    e: [["f", "SourceFile", true]],
    s: [
      [null, "f", "path", null, FOOTER, {}, null, null],
      [null, "f", "defines", "f#prFooter", null, {}, null, null],
      [null, "f#prFooter", "symbol", null, "prFooter", {}, null, null],
      [null, "f#prFooter", "line_start", null, "20", {}, null, null],
      [null, "f#prFooter", "line_end", null, "31", {}, null, null],
    ],
    external_id: `code:${FOOTER}`,
  });
  const TICKET = `Footer names the task\n\nEdit \`${FOOTER}\` so prFooter adds the Refs line.`;
  const section = (source: string) =>
    ({ source }) as Parameters<ReturnType<typeof utopiaSectionReader>>[0];
  const searchByQuery = (asked: string[]): UtopiaReads => ({
    search: async (_kbId, q): Promise<SearchPage> => {
      asked.push(q);

      return {
        hits:
          q === "pr-body.ts pr-body prFooter"
            ? [hit(`code:${FOOTER}`, codeText, 0.02, { sourceId: COVERAGE })]
            : [hit(`doc:${SPEC}`, specFirst, 0.03)],
        hasMore: false,
        vectorUsed: true,
      };
    },
    documentByExternalId: async () => null,
  });

  it("asks a second search 'pr-body.ts pr-body prFooter' for code, both its pages at once, and fills it with pr-body.ts, while repo reads the ticket's own search", async () => {
    const asked: string[] = [];
    const read = utopiaSectionReader(
      {
        reads: searchByQuery(asked),
        kbId: "kb-1",
        docsSourceId: DOCS,
        coverageSourceId: COVERAGE,
      },
      TICKET,
    );
    const [code, repo] = await Promise.all([
      read(section("code")),
      read(section("repo")),
    ]);

    expect({
      asked: [...new Set(asked)].sort(),
      code: code.sources.map(({ source_path }) => source_path),
      repo: repo.sources.map(({ source_path }) => source_path),
    }).toEqual({
      asked: [TICKET, "pr-body.ts pr-body prFooter"],
      code: [FOOTER],
      repo: [SPEC],
    });
  });

  it("reads code from the ticket's own search when the ticket names no file or symbol", async () => {
    const asked: string[] = [];
    const read = utopiaSectionReader(
      {
        reads: searchByQuery(asked),
        kbId: "kb-1",
        docsSourceId: DOCS,
        coverageSourceId: COVERAGE,
      },
      "Make the digest shorter.",
    );

    await Promise.all([read(section("code")), read(section("repo"))]);

    expect([...new Set(asked)]).toEqual(["Make the digest shorter."]);
  });
});

describe("utopiaSectionReader memories filtered to the ticket's names (FR13.9)", () => {
  const memoryHit = (key: string, value: string, score: number) => ({
    key,
    value,
    score,
    agent_id: "a",
    source: "memory" as const,
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
  const found = [
    memoryHit("dod/4012", "triage failed label on a credit failure", 1),
    memoryHit("board-pill", "Board.ts draws one pill per loop", 0.9),
    memoryHit("dod/3990", "execution images are built by hand", 0.8),
    memoryHit("loop-paused", "LoopPaused.tsx has the resume button", 0.7),
    memoryHit("session-1", "mentions loopEnabled in passing", 0.6),
    memoryHit("session-2", "loopEnabled reads each loop's own key", 0.5),
  ];
  const read = (query: string) =>
    utopiaSectionReader(
      {
        reads: noSearch,
        kbId: "kb",
        docsSourceId: DOCS,
        memories: async () => found,
      },
      query,
    )({ source: "memories" } as Parameters<
      ReturnType<typeof utopiaSectionReader>
    >[0]);

  it("keeps the three best memories that name board.ts, LoopPaused.tsx or loopEnabled and drops the DoD runs of other tickets", async () => {
    const memories = await read(
      "Pause on the pill\n\nEdit `apps/web-ui/src/app/loops/board/board.ts`, reuse LoopPaused.tsx and loopEnabled.",
    );

    expect(memories.sources.map(({ source_path }) => source_path)).toEqual([
      "board-pill",
      "loop-paused",
      "session-1",
    ]);
  });

  it("keeps no memory when the ticket names no file or symbol", async () => {
    const memories = await read("Make the digest shorter.");

    expect(memories).toEqual({ sources: [], status: "empty" });
  });
});

describe("utopiaSectionReader doc items widened from the stored document (FR13.10)", () => {
  const PAUSE_SPEC = "specs/loop-pause/spec.md";
  const stored = firstChunk(
    PAUSE_SPEC,
    "spec",
    "# Loop pause\n\n## Requirements\n\n- FR4 — A paused loop's pill shows the reason, since when, and until when if the pause has an end.\n- FR5 — Resuming a loop deletes its pause row.\n",
  );
  const section = (source: string) =>
    ({ source }) as Parameters<ReturnType<typeof utopiaSectionReader>>[0];
  const reads = (document: string | null, asked: string[]): UtopiaReads => ({
    search: async (): Promise<SearchPage> => ({
      hits: [
        hit(`doc:${PAUSE_SPEC}`, "until when if the pause has an end.", 0.03, {
          seq: 3,
        }),
      ],
      hasMore: false,
      vectorUsed: true,
    }),
    documentByExternalId: async (_kb, sourceId, externalId) => {
      asked.push(`${sourceId} ${externalId}`);

      return document === null
        ? null
        : {
            id: "d1",
            externalId,
            filename: PAUSE_SPEC,
            status: "ready",
            docTime: null,
            version: 2,
            content: document,
          };
    },
  });

  it("reads specs/loop-pause/spec.md from the docs source and gives the whole FR4 line under its heading instead of the cut chunk", async () => {
    const asked: string[] = [];
    const repo = await utopiaSectionReader(
      { reads: reads(stored, asked), kbId: "kb", docsSourceId: DOCS },
      "pause pill",
    )(section("repo"));

    expect({ asked, texts: repo.sources.map(({ text }) => text) }).toEqual({
      asked: [`${DOCS} doc:${PAUSE_SPEC}`],
      texts: [
        "## Requirements\n- FR4 — A paused loop's pill shows the reason, since when, and until when if the pause has an end.",
      ],
    });
  });

  it("keeps the chunk as it came when the stored document is gone", async () => {
    const repo = await utopiaSectionReader(
      { reads: reads(null, []), kbId: "kb", docsSourceId: DOCS },
      "pause pill",
    )(section("repo"));

    expect(repo.sources.map(({ text }) => text)).toEqual([
      "until when if the pause has an end.",
    ]);
  });
});
