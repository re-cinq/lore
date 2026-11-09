import { describe, expect, it } from "vitest";
import type {
  DgraphClientPort,
  DgraphTxn,
} from "../../outbound/memory-store.js";
import { mainScope } from "../../domain/spec-trace/trace-scope.js";
import { ingestTestReport, type TestReport } from "./ingest-test-report.js";
import {
  isChunkUnchanged,
  isCoverageUnchanged,
  isSuiteUnchanged,
  storedTestLayerOf,
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
  name: "ticks",
  file: CLOCK,
  start: 1,
  end: 3,
  coverageUids: ["0x9"],
};

const TICKS_COVERAGE: StoredCoverage = {
  uid: "0x9",
  tool: "test-interface",
  covers: new Map([["src/clock.ts", { uid: "0x3", ranges: "2-5" }]]),
};

const TICKS_PLANNED = {
  tool: "test-interface",
  covers: new Map([["src/clock.ts", "2-5"]]),
};

describe("isChunkUnchanged", () => {
  it("keeps a test the graph holds with the name, file and lines the report gives", () => {
    expect(
      isChunkUnchanged(TICKS_CHUNK, {
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
        name: "ticks",
        file: CLOCK,
        start: 4,
        end: 6,
      }),
    ).toBe(false);
  });

  it("keeps a test the report gives no lines for, as an upsert never clears the stored ones", () => {
    expect(isChunkUnchanged(TICKS_CHUNK, { name: "ticks", file: CLOCK })).toBe(
      true,
    );
  });

  it("writes a test the graph does not hold", () => {
    expect(isChunkUnchanged(undefined, { name: "ticks", file: CLOCK })).toBe(
      false,
    );
  });
});

describe("isSuiteUnchanged", () => {
  it("writes a suite level whose parent is now 0x5 rather than 0x4, and keeps one whose name, file and parent match", () => {
    const stored = {
      uid: "0x7",
      name: "Widget",
      file: WIDGET,
      parentUid: "0x4",
    };

    expect([
      isSuiteUnchanged(stored, {
        name: "Widget",
        file: WIDGET,
        parentUid: "0x5",
      }),
      isSuiteUnchanged(stored, {
        name: "Widget",
        file: WIDGET,
        parentUid: "0x4",
      }),
    ]).toEqual([false, true]);
  });
});

describe("isCoverageUnchanged", () => {
  it("keeps a coverage with the same tool and ranges, pointed at by its one test alone", () => {
    expect(
      isCoverageUnchanged(TICKS_COVERAGE, TICKS_PLANNED, [TICKS_CHUNK]),
    ).toBe(true);
  });

  it("writes a coverage whose ranges on src/clock.ts grew from 2-5 to 2-6", () => {
    const grown = {
      ...TICKS_PLANNED,
      covers: new Map([["src/clock.ts", "2-6"]]),
    };

    expect(isCoverageUnchanged(TICKS_COVERAGE, grown, [TICKS_CHUNK])).toBe(
      false,
    );
  });

  it("writes a coverage that now covers src/tick.ts as well", () => {
    const wider = {
      ...TICKS_PLANNED,
      covers: new Map([
        ["src/clock.ts", "2-5"],
        ["src/tick.ts", "1-2"],
      ]),
    };

    expect(isCoverageUnchanged(TICKS_COVERAGE, wider, [TICKS_CHUNK])).toBe(
      false,
    );
  });

  it("writes a coverage two tests named ticks point at, as a lookup by name could land on either", () => {
    const twin = { ...TICKS_CHUNK, uid: "0x2" };

    expect(
      isCoverageUnchanged(TICKS_COVERAGE, TICKS_PLANNED, [TICKS_CHUNK, twin]),
    ).toBe(false);
  });
});

describe("storedTestLayerOf", () => {
  it("reads a chunk's single suite edge as an object, its coverage by xid with each file's ranges facet, and drops a row with no xid", () => {
    const layer = storedTestLayerOf({
      chunks: [
        {
          uid: "0x1",
          xid: `${REPO}|${TICKS}`,
          name: "ticks",
          file: CLOCK,
          start: 1,
          end: 3,
          suite: { uid: "0x7" },
          coverage: [
            {
              uid: "0x9",
              xid: `${REPO}|${CLOCK}|ticks`,
              tool: "test-interface",
              commit: FIRST_COMMIT,
              "Coverage.covers": [
                {
                  uid: "0x3",
                  path: "src/clock.ts",
                  "Coverage.covers|ranges": "2-5",
                },
              ],
            },
          ],
        },
        { uid: "0x2", name: "no xid" },
      ],
      suites: [{ uid: "0x7", xid: `${REPO}|${WIDGET}|Widget`, name: "Widget" }],
    });

    expect({
      chunks: Object.fromEntries(layer.chunks),
      suites: Object.fromEntries(layer.suites),
      coverage: Object.fromEntries(layer.coverage),
    }).toEqual({
      chunks: {
        [`${REPO}|${TICKS}`]: { ...TICKS_CHUNK, suiteUid: "0x7" },
      },
      suites: { [`${REPO}|${WIDGET}|Widget`]: { uid: "0x7", name: "Widget" } },
      coverage: {
        [`${REPO}|${CLOCK}|ticks`]: { ...TICKS_COVERAGE, commit: FIRST_COMMIT },
      },
    });
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

function fakeGraph(): FakeGraph {
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

      return { data: answer(store, query, vars) };
    },
    mutate: async (request) => ({
      data: { uids: applyMutation(store, request) },
    }),
    discard: async () => {},
  };

  return { port: { newTxn: () => txn }, store };
}

type Answer = (
  store: Store,
  query: string,
  vars: Record<string, string>,
) => Record<string, Row[]>;

const ANSWERS: [RegExp, Answer][] = [
  [/found\(func: eq\(/, foundAnswer],
  [/chunks\(func: eq\(TestChunk\.file_path, \[/, storedAnswer],
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

function storedAnswer(
  store: Store,
  query: string,
  vars: Record<string, string>,
): Record<string, Row[]> {
  const files = JSON.parse(
    /eq\(TestChunk\.file_path, (\[.*?\])\)/s.exec(query)?.[1] ?? "[]",
  ) as string[];
  const scoped = (type: string) =>
    nodesOf(store, type).filter(
      ([, node]) =>
        files.includes(String(node.fields[`${type}.file_path`])) &&
        node.fields[`${type}.repo`] === vars["$repo"],
    );

  return {
    chunks: scoped("TestChunk").map((entry) => chunkRow(store, entry)),
    suites: scoped("TestSuite").map(suiteRow),
  };
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

function chunkRow(store: Store, [uid, node]: [string, GraphNode]): Row {
  const field = (name: string) => node.fields[`TestChunk.${name}`];

  return {
    uid,
    xid: field("xid"),
    name: field("test_name"),
    file: field("file_path"),
    start: field("start_line"),
    end: field("end_line"),
    suite: targetsOf(node, "TestChunk.suite").map((target) => ({
      uid: target,
    }))[0],
    coverage: targetsOf(node, "TestChunk.coverage").map((target) =>
      coverageRow(store, target),
    ),
  };
}

function coverageRow(store: Store, uid: string): Row {
  const node = store.nodes.get(uid);
  const covers = node?.edges.get("Coverage.covers") ?? new Map<string, Row>();

  return {
    uid,
    xid: node?.fields["Coverage.xid"],
    tool: node?.fields["Coverage.tool"],
    commit: node?.fields["Coverage.commit"],
    "Coverage.covers": [...covers].map(([fileUid, facets]) => ({
      uid: fileUid,
      path: store.nodes.get(fileUid)?.fields["File.path"],
      ...facets,
    })),
  };
}

function suiteRow([uid, node]: [string, GraphNode]): Row {
  return {
    uid,
    xid: node.fields["TestSuite.xid"],
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
