import { describe, expect, it, vi } from "vitest";
import type {
  DgraphClientPort,
  DgraphTxn,
} from "../../outbound/memory-store.js";
import { mainScope } from "../../domain/spec-trace/trace-scope.js";
import { enforceTrue } from "../../lib/enforce.js";
import { ingestTestReport, type TestReport } from "./ingest-test-report.js";
import {
  storedTestLayerOf,
  storedTestLayerQuery,
} from "./read-stored-test-layer.js";
import {
  isChunkUnchanged,
  isCoverageUnchanged,
  isSuiteUnchanged,
  NO_STORED_TESTS,
  withTouched,
  type StoredCoverage,
  type StoredTestChunk,
} from "./stored-test-layer.js";

const REPO = "re-cinq/lore";
const SCOPE = mainScope(REPO);
const WIDGET = "src/widget.test.ts";
const CLOCK = "src/clock.test.ts";
const RENDERS = `${WIDGET}::Widget > renders messages`;
const COLOUR = `${WIDGET}::Widget > accepts a colour`;
const TICKS = `${CLOCK}::ticks`;
const FIRST_COMMIT = "a".repeat(40);
const NEXT_COMMIT = "b".repeat(40);
const CLOCK_SOURCE_XID = `${REPO}|src/clock.ts`;

const REPORT: TestReport = {
  commit: FIRST_COMMIT,
  branch: "main",
  tests: [
    {
      id: RENDERS,
      name: "Widget > renders messages",
      file: WIDGET,
      startLine: 3,
      endLine: 5,
      suite: ["Widget"],
    },
    {
      id: COLOUR,
      name: "Widget > accepts a colour",
      file: WIDGET,
      startLine: 7,
      endLine: 9,
      suite: ["Widget"],
    },
    { id: TICKS, name: "ticks", file: CLOCK, startLine: 1, endLine: 3 },
  ],
  results: [
    {
      id: RENDERS,
      passed: true,
      covered: [{ file: "src/widget.ts", startLine: 1, endLine: 4 }],
    },
    {
      id: COLOUR,
      passed: true,
      covered: [{ file: "src/widget.ts", startLine: 6, endLine: 8 }],
    },
    {
      id: TICKS,
      passed: true,
      covered: [{ file: "src/clock.ts", startLine: 2, endLine: 5 }],
    },
  ],
};

const TICKS_CHUNK: StoredTestChunk = {
  uid: "0x1",
  repo: REPO,
  name: "ticks",
  file: CLOCK,
  start: 1,
  end: 3,
  coverageUids: ["0x9"],
};

const TICKS_COVERAGE: StoredCoverage = {
  uid: "0x9",
  repo: REPO,
  tool: "test-interface",
  covers: new Map([
    [
      "src/clock.ts",
      { uid: "0x3", xid: CLOCK_SOURCE_XID, repo: REPO, ranges: "2-5" },
    ],
  ]),
  wellFormed: true,
};

const TICKS_PLANNED = {
  repo: REPO,
  tool: "test-interface",
  covers: new Map([
    ["src/clock.ts", { ranges: "2-5", fileXid: CLOCK_SOURCE_XID }],
  ]),
};

const TICKS_CONTEXT = {
  sources: new Map([[CLOCK_SOURCE_XID, "0x3"]]),
  holders: [TICKS_CHUNK],
};

describe("isChunkUnchanged", () => {
  it("keeps a test the graph holds with the repo, name, file and lines the report gives", () => {
    expect(
      isChunkUnchanged(TICKS_CHUNK, {
        repo: REPO,
        name: "ticks",
        file: CLOCK,
        start: 1,
        end: 3,
      }),
    ).toBe(true);
  });

  it("writes a test whose lines moved from 1-3 to 4-6", () => {
    expect(
      isChunkUnchanged(TICKS_CHUNK, {
        repo: REPO,
        name: "ticks",
        file: CLOCK,
        start: 4,
        end: 6,
      }),
    ).toBe(false);
  });

  it("keeps a test the report gives no lines for, as an upsert never clears the stored ones", () => {
    expect(
      isChunkUnchanged(TICKS_CHUNK, { repo: REPO, name: "ticks", file: CLOCK }),
    ).toBe(true);
  });

  it("writes a test the graph does not hold", () => {
    expect(
      isChunkUnchanged(undefined, { repo: REPO, name: "ticks", file: CLOCK }),
    ).toBe(false);
  });

  it("writes a test whose node the graph holds under another repo", () => {
    expect(
      isChunkUnchanged(
        { ...TICKS_CHUNK, repo: "re-cinq/other" },
        { repo: REPO, name: "ticks", file: CLOCK },
      ),
    ).toBe(false);
  });
});

describe("isSuiteUnchanged", () => {
  it("writes a suite level whose parent is now 0x5 rather than 0x4, and keeps one whose repo, name, file and parent match", () => {
    const stored = {
      uid: "0x7",
      repo: REPO,
      name: "Widget",
      file: WIDGET,
      parentUid: "0x4",
    };
    const planned = { repo: REPO, name: "Widget", file: WIDGET };

    expect([
      isSuiteUnchanged(stored, { ...planned, parentUid: "0x5" }),
      isSuiteUnchanged(stored, { ...planned, parentUid: "0x4" }),
    ]).toEqual([false, true]);
  });
});

describe("isCoverageUnchanged", () => {
  it("keeps a coverage with the same repo, tool and ranges on the File node an upsert would find, pointed at by its one test alone", () => {
    expect(
      isCoverageUnchanged(TICKS_COVERAGE, TICKS_PLANNED, TICKS_CONTEXT),
    ).toBe(true);
  });

  it("writes a coverage whose ranges on src/clock.ts grew from 2-5 to 2-6", () => {
    const grown = {
      ...TICKS_PLANNED,
      covers: new Map([
        ["src/clock.ts", { ranges: "2-6", fileXid: CLOCK_SOURCE_XID }],
      ]),
    };

    expect(isCoverageUnchanged(TICKS_COVERAGE, grown, TICKS_CONTEXT)).toBe(
      false,
    );
  });

  it("writes a coverage that now covers src/tick.ts as well", () => {
    const wider = {
      ...TICKS_PLANNED,
      covers: new Map([
        ["src/clock.ts", { ranges: "2-5", fileXid: CLOCK_SOURCE_XID }],
        ["src/tick.ts", { ranges: "1-2", fileXid: `${REPO}|src/tick.ts` }],
      ]),
    };

    expect(isCoverageUnchanged(TICKS_COVERAGE, wider, TICKS_CONTEXT)).toBe(
      false,
    );
  });

  it("writes a coverage two tests named ticks point at, as a lookup by name could land on either", () => {
    const twin = { ...TICKS_CHUNK, uid: "0x2" };

    expect(
      isCoverageUnchanged(TICKS_COVERAGE, TICKS_PLANNED, {
        ...TICKS_CONTEXT,
        holders: [TICKS_CHUNK, twin],
      }),
    ).toBe(false);
  });

  it("writes a coverage whose src/clock.ts edge points at a feat/x overlay's File node", () => {
    const stray: StoredCoverage = {
      ...TICKS_COVERAGE,
      covers: new Map([
        [
          "src/clock.ts",
          {
            uid: "0x3",
            xid: `${REPO}|branch:feat/x|src/clock.ts`,
            ranges: "2-5",
          },
        ],
      ]),
    };

    expect(isCoverageUnchanged(stray, TICKS_PLANNED, TICKS_CONTEXT)).toBe(
      false,
    );
  });

  it("writes a coverage whose covered file's xid two File nodes hold, so the read cannot say which one an upsert finds", () => {
    expect(
      isCoverageUnchanged(TICKS_COVERAGE, TICKS_PLANNED, {
        ...TICKS_CONTEXT,
        sources: new Map(),
      }),
    ).toBe(false);
  });

  it("writes a coverage whose test the report creates or moves, so the read cannot say where the link's lookup lands", () => {
    expect(
      isCoverageUnchanged(TICKS_COVERAGE, TICKS_PLANNED, {
        ...TICKS_CONTEXT,
        holders: undefined,
      }),
    ).toBe(false);
  });

  it("writes a coverage whose covered File node holds another repo", () => {
    const foreign: StoredCoverage = {
      ...TICKS_COVERAGE,
      covers: new Map([
        [
          "src/clock.ts",
          {
            uid: "0x3",
            xid: CLOCK_SOURCE_XID,
            repo: "re-cinq/other",
            ranges: "2-5",
          },
        ],
      ]),
    };

    expect(isCoverageUnchanged(foreign, TICKS_PLANNED, TICKS_CONTEXT)).toBe(
      false,
    );
  });

  it("writes a coverage one of whose covered files the read found without a path", () => {
    expect(
      isCoverageUnchanged(
        { ...TICKS_COVERAGE, wellFormed: false },
        TICKS_PLANNED,
        TICKS_CONTEXT,
      ),
    ).toBe(false);
  });
});

describe("storedTestLayerOf", () => {
  it("reads a chunk's single suite edge as an object, a coverage's covered files with their xid and ranges facet, and the File nodes by xid", () => {
    const layer = storedTestLayerOf({
      chunks: [
        {
          uid: "0x1",
          xid: `${REPO}|${TICKS}`,
          repo: REPO,
          name: "ticks",
          file: CLOCK,
          start: 1,
          end: 3,
          suite: { uid: "0x7" },
        },
      ],
      coverage: [
        {
          uid: "0x9",
          xid: `${REPO}|${CLOCK}|ticks`,
          repo: REPO,
          tool: "test-interface",
          "Coverage.covers": [
            {
              uid: "0x3",
              path: "src/clock.ts",
              xid: CLOCK_SOURCE_XID,
              repo: REPO,
              "Coverage.covers|ranges": "2-5",
            },
          ],
        },
      ],
      sources: [{ uid: "0x3", xid: CLOCK_SOURCE_XID }],
      holders: [
        { uid: "0x1", name: "ticks", file: CLOCK, coverage: [{ uid: "0x9" }] },
      ],
    });

    expect({
      chunks: Object.fromEntries(layer.chunks),
      coverage: Object.fromEntries(layer.coverage),
      sources: Object.fromEntries(layer.sources),
    }).toEqual({
      chunks: {
        [`${REPO}|${TICKS}`]: {
          ...TICKS_CHUNK,
          suiteUid: "0x7",
          coverageUids: [],
        },
      },
      coverage: { [`${REPO}|${CLOCK}|ticks`]: TICKS_COVERAGE },
      sources: { [CLOCK_SOURCE_XID]: "0x3" },
    });
  });

  it("reads a coverage as not well formed when its src/clock.ts edge carries a hits facet besides ranges", () => {
    const layer = storedTestLayerOf({
      coverage: [
        {
          uid: "0x9",
          xid: `${REPO}|${CLOCK}|ticks`,
          "Coverage.covers": [
            {
              uid: "0x3",
              path: "src/clock.ts",
              xid: CLOCK_SOURCE_XID,
              "Coverage.covers|ranges": "2-5",
              "Coverage.covers|hits": 3,
            },
          ],
        },
      ],
    });

    expect(layer.coverage.get(`${REPO}|${CLOCK}|ticks`)?.wellFormed).toBe(
      false,
    );
  });

  it("drops an xid two TestChunk nodes hold, so the upsert's own lookup decides which one is written", () => {
    const layer = storedTestLayerOf({
      chunks: [
        { uid: "0x1", xid: `${REPO}|${TICKS}`, name: "ticks" },
        { uid: "0x2", xid: `${REPO}|${TICKS}`, name: "ticks" },
      ],
    });

    expect(layer.chunks.size).toBe(0);
  });
});

describe("storedTestLayerQuery", () => {
  it("quotes every value as a JSON string, keeps a $& in a test name as written, and leaves out the suites block when no test has a suite", () => {
    const query = storedTestLayerQuery(SCOPE, {
      files: [CLOCK],
      chunks: [`${REPO}|${CLOCK}::costs $& "more"`],
      suites: [],
      coverage: [],
      sources: [],
    });

    expect({
      quoted: query.includes(
        `eq(TestChunk.xid, [${JSON.stringify(`${REPO}|${CLOCK}::costs $& "more"`)}])`,
      ),
      repo: query.includes(`eq(TestChunk.repo, ${JSON.stringify(REPO)})`),
      suites: query.includes("TestSuite.xid"),
    }).toEqual({ quoted: true, repo: true, suites: false });
  });
});

describe("withTouched", () => {
  it("marks the name of a test the graph does not hold and both names of a file chunk a spec citation renamed, and leaves a test held as written unmarked", () => {
    const layer = withTouched(
      {
        ...NO_STORED_TESTS,
        chunks: new Map([
          [`${REPO}|${TICKS}`, TICKS_CHUNK],
          [
            `${REPO}|${CLOCK}`,
            { ...TICKS_CHUNK, uid: "0x5", name: "ticks", file: CLOCK },
          ],
        ]),
      },
      SCOPE,
      [
        ...REPORT.tests.filter((test) => test.id === TICKS),
        { id: `${CLOCK}::tocks`, name: "tocks", file: CLOCK },
      ],
    );

    expect([...layer.touched].sort()).toEqual(
      [
        JSON.stringify([CLOCK, "tocks"]),
        JSON.stringify([CLOCK, CLOCK]),
        JSON.stringify([CLOCK, "ticks"]),
      ].sort(),
    );
  });
});

describe("ingestTestReport skipping what the graph holds (fake port)", () => {
  it("writes no test, suite, coverage or file node when the same report comes again", async () => {
    const graph = fakeGraph();

    await ingestTestReport(graph.port, SCOPE, REPORT);
    const again = await ingest(graph, REPORT);

    expect(upsertsByType(again.queries)).toEqual({});
  });

  it("rewrites only the ticks test when its lines move from 1-3 to 4-6, and keeps its coverage", async () => {
    const graph = fakeGraph();

    await ingestTestReport(graph.port, SCOPE, REPORT);
    const again = await ingest(graph, moveTicks(REPORT));

    expect(upsertsByType(again.queries)).toEqual({ TestChunk: 1 });
  });

  it("rewrites the clock file's two coverage nodes and its covered file once when the ticks ranges grow from 2-5 to 2-6", async () => {
    const graph = fakeGraph();

    await ingestTestReport(graph.port, SCOPE, REPORT);
    const again = await ingest(graph, growTicks(REPORT));

    expect(upsertsByType(again.queries)).toEqual({ Coverage: 2, File: 1 });
  });

  it("brings all five kept coverage nodes to a new commit in one write", async () => {
    const graph = fakeGraph();

    await ingestTestReport(graph.port, SCOPE, REPORT);
    const again = await ingest(graph, { ...REPORT, commit: NEXT_COMMIT });

    expect(again.nquads).toEqual([{ predicate: "Coverage.commit", lines: 5 }]);
    expect(upsertsByType(again.queries)).toEqual({});
    expect(
      fieldOf(graph, `Coverage|${REPO}|${CLOCK}|ticks`, "Coverage.commit"),
    ).toBe(NEXT_COMMIT);
  });

  it("leaves the graph a fresh ingest of the changed report leaves", async () => {
    const replayed = fakeGraph();
    const fresh = fakeGraph();
    const changed = growTicks(moveTicks({ ...REPORT, commit: NEXT_COMMIT }));

    await ingestTestReport(replayed.port, SCOPE, REPORT);
    await ingestTestReport(replayed.port, SCOPE, changed);
    await ingestTestReport(fresh.port, SCOPE, changed);

    expect(snapshotOf(replayed)).toEqual(snapshotOf(fresh));
  });

  it("ends with the last of two ticks tests that share an id, at lines 4-6 rather than 1-3, as a fresh ingest of the same report does", async () => {
    const replayed = fakeGraph();
    const fresh = fakeGraph();
    const twice: TestReport = {
      ...REPORT,
      tests: [
        ...REPORT.tests,
        { id: TICKS, name: "ticks", file: CLOCK, startLine: 4, endLine: 6 },
      ],
    };

    await ingestTestReport(replayed.port, SCOPE, twice);
    await ingestTestReport(replayed.port, SCOPE, twice);
    await ingestTestReport(fresh.port, SCOPE, twice);

    expect(
      fieldOf(replayed, `TestChunk|${REPO}|${TICKS}`, "TestChunk.start_line"),
    ).toBe(4);
    expect(snapshotOf(replayed)).toEqual(snapshotOf(fresh));
  });

  it("rewrites the ticks coverage when a test named ticks comes under a new id while the old one is still in the graph", async () => {
    const graph = fakeGraph();
    const reidentified: TestReport = {
      ...REPORT,
      tests: REPORT.tests.map((test) =>
        test.id === TICKS ? { ...test, id: `${CLOCK}::ticks#2` } : test,
      ),
      results: REPORT.results.map((result) =>
        result.id === TICKS ? { ...result, id: `${CLOCK}::ticks#2` } : result,
      ),
    };

    await ingestTestReport(graph.port, SCOPE, REPORT);
    const again = await ingest(graph, reidentified);

    expect(upsertsByType(again.queries)).toEqual({
      TestChunk: 1,
      Coverage: 1,
    });
  });

  it("writes every node as a first ingest does, and logs why, when the read of what the graph holds fails", async () => {
    const graph = fakeGraph({ failRead: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await ingestTestReport(graph.port, SCOPE, REPORT);
    const again = await ingest(graph, REPORT);

    expect(upsertsByType(again.queries)).toEqual({
      TestSuite: 2,
      TestChunk: 5,
      Coverage: 5,
      File: 2,
    });
    expect(String(logged.mock.calls[0]?.[0])).toContain(
      "reading what the graph holds failed",
    );
    logged.mockRestore();
  });
});

function moveTicks(report: TestReport): TestReport {
  return {
    ...report,
    tests: report.tests.map((test) =>
      test.id === TICKS ? { ...test, startLine: 4, endLine: 6 } : test,
    ),
  };
}

function growTicks(report: TestReport): TestReport {
  return {
    ...report,
    results: report.results.map((result) =>
      result.id === TICKS
        ? {
            ...result,
            covered: [{ file: "src/clock.ts", startLine: 2, endLine: 6 }],
          }
        : result,
    ),
  };
}

async function ingest(graph: FakeGraph, report: TestReport) {
  const queriesBefore = graph.store.queries.length;
  const nquadsBefore = graph.store.nquads.length;

  await ingestTestReport(graph.port, SCOPE, report);

  return {
    queries: graph.store.queries.slice(queriesBefore),
    nquads: graph.store.nquads.slice(nquadsBefore),
  };
}

function upsertsByType(queries: string[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const query of queries) {
    const type = /found\(func: eq\((\w+)\.xid/.exec(query)?.[1];

    if (type !== undefined && type !== "Repo") {
      counts[type] = (counts[type] ?? 0) + 1;
    }
  }

  return counts;
}

type Row = Record<string, unknown>;

interface GraphNode {
  type: string;
  fields: Row;
  edges: Map<string, Map<string, Row>>;
}

interface Store {
  nodes: Map<string, GraphNode>;
  uidByKey: Map<string, string>;
  queries: string[];
  nquads: { predicate: string; lines: number }[];
  next: number;
}

interface FakeGraph {
  port: DgraphClientPort;
  store: Store;
}

function fakeGraph({ failRead = false } = {}): FakeGraph {
  const store: Store = {
    nodes: new Map(),
    uidByKey: new Map(),
    queries: [],
    nquads: [],
    next: 1,
  };
  const txn: DgraphTxn = {
    queryWithVars: async (query, vars) => {
      store.queries.push(query);

      enforceTrue(
        !(failRead && STORED_READ.test(query)),
        Error,
        "Dgraph refused the query",
      );

      return { data: answer(store, query, vars) };
    },
    mutate: async (request) => ({
      data: { uids: applyMutation(store, request) },
    }),
    discard: async () => {},
  };

  return { port: { newTxn: () => txn }, store };
}

const STORED_READ = /^\{\s*(holders|chunks)\(func:/;

type Answer = (
  store: Store,
  query: string,
  vars: Record<string, string>,
) => Record<string, Row[]>;

const ANSWERS: [RegExp, Answer][] = [
  [/found\(func: eq\(/, foundAnswer],
  [STORED_READ, storedAnswer],
  [/cov\(func: uid\(\$uid\)\)/, coversAnswer],
  [/tc\(func: eq\(TestChunk\.file_path, \$file\)\)/, testChunkAnswer],
];

function answer(
  store: Store,
  query: string,
  vars: Record<string, string>,
): Record<string, Row[]> {
  const respond = ANSWERS.find(([pattern]) => pattern.test(query))?.[1];

  return respond ? respond(store, query, vars) : {};
}

function foundAnswer(
  store: Store,
  query: string,
  vars: Record<string, string>,
): Record<string, Row[]> {
  const type = /eq\((\w+)\.xid/.exec(query)?.[1];
  const uid = store.uidByKey.get(`${type}|${vars["$xid"]}`);

  return { found: uid !== undefined && store.nodes.has(uid) ? [{ uid }] : [] };
}

function storedAnswer(store: Store, query: string): Record<string, Row[]> {
  const byXid = (type: string, block: string) => {
    const xids = listIn(query, block, `${type}.xid`);

    return nodesOf(store, type).filter(([, node]) =>
      xids.includes(String(node.fields[`${type}.xid`])),
    );
  };
  const repo = JSON.parse(
    /eq\(TestChunk\.repo, ("(?:[^"\\]|\\.)*")\)/.exec(query)?.[1] ?? '""',
  ) as string;
  const files = listIn(query, "holders", "TestChunk.file_path");
  const holders = nodesOf(store, "TestChunk").filter(
    ([, node]) =>
      files.includes(String(node.fields["TestChunk.file_path"])) &&
      node.fields["TestChunk.repo"] === repo,
  );

  return {
    holders: holders.map((entry) => chunkRow(entry)),
    chunks: byXid("TestChunk", "chunks").map((entry) => chunkRow(entry)),
    suites: byXid("TestSuite", "suites").map(suiteRow),
    coverage: byXid("Coverage", "coverage").map((entry) =>
      coverageRow(store, entry),
    ),
    sources: byXid("File", "sources").map(([uid, node]) => ({
      uid,
      xid: node.fields["File.xid"],
    })),
  };
}

const JSON_LIST = /(\[(?:"(?:[^"\\]|\\.)*"(?:, )?)*\])/.source;

function listIn(query: string, block: string, predicate: string): string[] {
  const pattern = new RegExp(
    `${block}\\(func: eq\\(${predicate.replace(".", "\\.")}, ${JSON_LIST}\\)`,
  );
  const match = pattern.exec(query)?.[1];

  return match ? (JSON.parse(match) as string[]) : [];
}

function coversAnswer(
  store: Store,
  _query: string,
  vars: Record<string, string>,
): Record<string, Row[]> {
  const node = store.nodes.get(vars["$uid"] ?? "");

  return {
    cov: [
      {
        "Coverage.covers": targetsOf(node, "Coverage.covers").map((uid) => ({
          uid,
        })),
      },
    ],
  };
}

function testChunkAnswer(
  store: Store,
  _query: string,
  vars: Record<string, string>,
): Record<string, Row[]> {
  const matches = nodesOf(store, "TestChunk").filter(
    ([, node]) =>
      node.fields["TestChunk.file_path"] === vars["$file"] &&
      node.fields["TestChunk.test_name"] === vars["$name"] &&
      node.fields["TestChunk.repo"] === vars["$repo"],
  );

  return { tc: matches.map(([uid]) => ({ uid })) };
}

function nodesOf(store: Store, type: string): [string, GraphNode][] {
  return [...store.nodes].filter(([, node]) => node.type === type);
}

function chunkRow([uid, node]: [string, GraphNode]): Row {
  const field = (name: string) => node.fields[`TestChunk.${name}`];

  return {
    uid,
    xid: field("xid"),
    repo: field("repo"),
    name: field("test_name"),
    file: field("file_path"),
    start: field("start_line"),
    end: field("end_line"),
    suite: targetsOf(node, "TestChunk.suite").map((target) => ({
      uid: target,
    }))[0],
    coverage: targetsOf(node, "TestChunk.coverage").map((target) => ({
      uid: target,
    })),
  };
}

function coverageRow(store: Store, [uid, node]: [string, GraphNode]): Row {
  const covers = node.edges.get("Coverage.covers") ?? new Map<string, Row>();

  return {
    uid,
    xid: node.fields["Coverage.xid"],
    repo: node.fields["Coverage.repo"],
    tool: node.fields["Coverage.tool"],
    commit: node.fields["Coverage.commit"],
    "Coverage.covers": [...covers].map(([fileUid, facets]) => {
      const file = store.nodes.get(fileUid);

      return {
        uid: fileUid,
        path: file?.fields["File.path"],
        xid: file?.fields["File.xid"],
        repo: file?.fields["File.repo"],
        ...facets,
      };
    }),
  };
}

function suiteRow([uid, node]: [string, GraphNode]): Row {
  return {
    uid,
    xid: node.fields["TestSuite.xid"],
    repo: node.fields["TestSuite.repo"],
    name: node.fields["TestSuite.name"],
    file: node.fields["TestSuite.file_path"],
    parent: targetsOf(node, "TestSuite.parent").map((target) => ({
      uid: target,
    }))[0],
  };
}

function targetsOf(node: GraphNode | undefined, predicate: string): string[] {
  return [...(node?.edges.get(predicate)?.keys() ?? [])];
}

function applyMutation(
  store: Store,
  request: { setJson?: unknown; setNquads?: string; deleteNquads?: string },
): Record<string, string> {
  const uids = request.setJson
    ? applySetJson(store, request.setJson as Row)
    : {};

  linesOf(request.deleteNquads).forEach((line) => applyDelete(store, line));
  recordNquads(store, linesOf(request.setNquads));

  return uids;
}

function applySetJson(store: Store, json: Row): Record<string, string> {
  const { uid, ...fields } = json;
  const label = String(uid);
  const target = label.startsWith("_:") ? createNode(store, fields) : label;

  Object.entries(fields).forEach(([predicate, value]) =>
    setPredicate(store.nodes.get(target), predicate, value),
  );

  return label.startsWith("_:") ? { [label.slice(2)]: target } : {};
}

function createNode(store: Store, fields: Row): string {
  const type = String(fields["dgraph.type"]);
  const uid = `0x${(store.next++).toString(16)}`;

  store.nodes.set(uid, { type, fields: {}, edges: new Map() });
  store.uidByKey.set(`${type}|${String(fields[`${type}.xid`])}`, uid);

  return uid;
}

function setPredicate(
  node: GraphNode | undefined,
  predicate: string,
  value: unknown,
): void {
  const targets = edgeTargets(value);

  if (node === undefined || value === undefined) {
    return;
  }

  if (targets === undefined) {
    node.fields[predicate] = value;

    return;
  }
  const edge = node.edges.get(predicate) ?? new Map<string, Row>();

  targets.forEach((target) =>
    edge.set(String(target["uid"]), facetsOf(target, predicate)),
  );
  node.edges.set(predicate, edge);
}

function edgeTargets(value: unknown): Row[] | undefined {
  const list = (Array.isArray(value) ? value : [value]) as unknown[];
  const isTarget = (candidate: unknown) =>
    candidate !== null && typeof candidate === "object" && "uid" in candidate;

  return list.length > 0 && list.every(isTarget) ? (list as Row[]) : undefined;
}

function facetsOf(target: Row, predicate: string): Row {
  return Object.fromEntries(
    Object.entries(target).filter(([key]) => key.startsWith(`${predicate}|`)),
  );
}

function applyDelete(store: Store, line: string): void {
  const [, uid = "", predicate = ""] =
    /<([^>]+)> (\*|<[^>]+>) \*/.exec(line) ?? [];
  const node = store.nodes.get(uid);

  if (predicate === "*") {
    store.nodes.delete(uid);

    return;
  }
  node?.edges.delete(predicate.slice(1, -1));
}

function recordNquads(store: Store, lines: string[]): void {
  const writes = lines.flatMap(nquadOf);

  writes.forEach(({ uid, predicate, value }) => {
    const node = store.nodes.get(uid);

    if (node) {
      node.fields[predicate] = value;
    }
  });

  if (writes.length > 0) {
    store.nquads.push({
      predicate: writes[0]?.predicate ?? "",
      lines: writes.length,
    });
  }
}

function nquadOf(
  line: string,
): { uid: string; predicate: string; value: unknown }[] {
  const [, uid, predicate, value] =
    /<([^>]+)> <([^>]+)> (".*") \.$/.exec(line) ?? [];

  return uid && predicate && value
    ? [{ uid, predicate, value: JSON.parse(value) }]
    : [];
}

function linesOf(nquads: string | undefined): string[] {
  return (nquads ?? "").split("\n").filter((line) => line.length > 0);
}

function fieldOf(graph: FakeGraph, key: string, predicate: string): unknown {
  const uid = graph.store.uidByKey.get(key) ?? "";

  return graph.store.nodes.get(uid)?.fields[predicate];
}

function snapshotOf(graph: FakeGraph): Record<string, unknown> {
  const { store } = graph;
  const kept = ["TestChunk", "TestSuite", "Coverage", "File"];

  return Object.fromEntries(
    [...store.nodes.values()]
      .filter((node) => kept.includes(node.type))
      .map((node) => [
        keyOf(node),
        { ...node.fields, ...edgesOf(store, node) },
      ]),
  );
}

function edgesOf(store: Store, node: GraphNode): Row {
  return Object.fromEntries(
    [...node.edges].map(([predicate, targets]) => [
      predicate,
      [...targets]
        .map(([uid, facets]) => ({ to: keyOfUid(store, uid), ...facets }))
        .sort((left, right) => left.to.localeCompare(right.to)),
    ]),
  );
}

function keyOfUid(store: Store, uid: string): string {
  const node = store.nodes.get(uid);

  return node ? keyOf(node) : `gone ${uid}`;
}

function keyOf(node: GraphNode): string {
  return `${node.type}|${String(node.fields[`${node.type}.xid`])}`;
}
