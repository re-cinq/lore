/** What a test report's files already hold in the graph, read once per report, so a suite, test or coverage the graph holds exactly as the report would write it is not written again: re-sending an unchanged suite costs one read instead of about twenty requests a test. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import type { TraceScope } from "../../domain/spec-trace/trace-scope.js";
import { edgeRows } from "./uid-refs.js";

/** A stored TestChunk, as far as deciding to skip it needs. */
export interface StoredTestChunk {
  uid: string;
  name?: string;
  file?: string;
  start?: number;
  end?: number;
  suiteUid?: string;
  coverageUids: string[];
}

/** A stored level of a suite chain. */
export interface StoredSuite {
  uid: string;
  name?: string;
  file?: string;
  parentUid?: string;
}

/** One file a stored Coverage covers: the File node and the ranges facet on the edge to it. */
export interface StoredCover {
  uid: string;
  ranges?: string;
}

/** A stored Coverage node, with the files it covers keyed by path. */
export interface StoredCoverage {
  uid: string;
  tool?: string;
  commit?: string;
  covers: ReadonlyMap<string, StoredCover>;
}

/** The TestChunks, TestSuites and Coverage nodes a report's files hold in one scope, keyed by xid. */
export interface StoredTestLayer {
  chunks: ReadonlyMap<string, StoredTestChunk>;
  suites: ReadonlyMap<string, StoredSuite>;
  coverage: ReadonlyMap<string, StoredCoverage>;
}

/** Nothing stored: a coverage-only payload, or a file never ingested, writes every node. */
export const NO_STORED_TESTS: StoredTestLayer = {
  chunks: new Map(),
  suites: new Map(),
  coverage: new Map(),
};

/** What the ingest would write for one suite level. */
export interface PlannedSuite {
  name: string | undefined;
  file: string;
  parentUid: string | undefined;
}

/** What the ingest would write for one TestChunk. */
export interface PlannedChunk {
  name: string;
  file: string;
  start?: number;
  end?: number;
  suiteUid?: string;
}

/** What the ingest would write for one Coverage node: its tool, and the ranges it covers keyed by file path. */
export interface PlannedCoverage {
  tool: string;
  covers: ReadonlyMap<string, string>;
}

/** True when the graph holds this suite level as the ingest would write it; a name or parent the upsert would not write is no change. */
export function isSuiteUnchanged(
  stored: StoredSuite | undefined,
  planned: PlannedSuite,
): boolean {
  return (
    stored !== undefined &&
    stored.file === planned.file &&
    writtenMatches(stored.name, planned.name) &&
    writtenMatches(stored.parentUid, planned.parentUid)
  );
}

/** True when the graph holds this TestChunk as the ingest would write it; lines and suite are compared only where written, as an upsert never clears them. */
export function isChunkUnchanged(
  stored: StoredTestChunk | undefined,
  planned: PlannedChunk,
): boolean {
  return (
    stored !== undefined &&
    stored.name === planned.name &&
    stored.file === planned.file &&
    writtenMatches(stored.start, planned.start) &&
    writtenMatches(stored.end, planned.end) &&
    writtenMatches(stored.suiteUid, planned.suiteUid)
  );
}

/** True when the graph holds this coverage as the ingest would write it: the same tool and the same ranges on the same files, with the one test its record names pointing at it alone. */
export function isCoverageUnchanged(
  stored: StoredCoverage | undefined,
  planned: PlannedCoverage,
  holders: StoredTestChunk[],
): boolean {
  return (
    stored !== undefined &&
    stored.tool === planned.tool &&
    sameCovers(stored.covers, planned.covers) &&
    pointsAtItAlone(holders, stored.uid)
  );
}

function writtenMatches<T>(
  stored: T | undefined,
  planned: T | undefined,
): boolean {
  return planned === undefined || stored === planned;
}

function sameCovers(
  stored: ReadonlyMap<string, StoredCover>,
  planned: ReadonlyMap<string, string>,
): boolean {
  return (
    stored.size === planned.size &&
    [...planned].every(([path, ranges]) => stored.get(path)?.ranges === ranges)
  );
}

// The record's test is looked up by file and name, so a second chunk with that name makes the lookup ambiguous and the record is written as before.
function pointsAtItAlone(
  holders: StoredTestChunk[],
  coverageUid: string,
): boolean {
  return (
    holders.length === 1 &&
    holders.every(
      ({ coverageUids }) =>
        coverageUids.length === 1 && coverageUids[0] === coverageUid,
    )
  );
}

// DQL's eq takes a list of values but no list variable, so the paths go in as JSON strings, which DQL reads as string literals.
const FILES = "@@FILES@@";

const STORED_TEST_LAYER_QUERY = `query q($repo: string) {
  chunks(func: eq(TestChunk.file_path, ${FILES})) @filter(eq(TestChunk.repo, $repo)) {
    uid
    xid: TestChunk.xid
    name: TestChunk.test_name
    file: TestChunk.file_path
    start: TestChunk.start_line
    end: TestChunk.end_line
    suite: TestChunk.suite { uid }
    coverage: TestChunk.coverage {
      uid
      xid: Coverage.xid
      tool: Coverage.tool
      commit: Coverage.commit
      Coverage.covers @facets(ranges) { uid path: File.path }
    }
  }
  suites(func: eq(TestSuite.file_path, ${FILES})) @filter(eq(TestSuite.repo, $repo)) {
    uid
    xid: TestSuite.xid
    name: TestSuite.name
    file: TestSuite.file_path
    parent: TestSuite.parent { uid }
  }
}`;

/** One read of everything the report's test files hold in this scope; a report with no tests reads nothing. */
export async function readStoredTestLayer(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  files: string[],
): Promise<StoredTestLayer> {
  if (files.length === 0) {
    return NO_STORED_TESTS;
  }

  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(storedTestLayerQuery(files), {
      $repo: scope.key,
    });

    return storedTestLayerOf(res.data);
  });
}

function storedTestLayerQuery(files: string[]): string {
  const list = `[${files.map((file) => JSON.stringify(file)).join(", ")}]`;

  return STORED_TEST_LAYER_QUERY.replaceAll(FILES, list);
}

/** The read's answer as maps by xid; each chunk's coverage nodes are gathered into a map of their own. */
export function storedTestLayerOf(
  answer: Record<string, unknown> | undefined,
): StoredTestLayer {
  const chunkRows = edgeRows(answer?.["chunks"]);

  return {
    chunks: byXid(chunkRows, chunkOf),
    suites: byXid(edgeRows(answer?.["suites"]), suiteOf),
    coverage: byXid(
      chunkRows.flatMap((row) => edgeRows(row["coverage"])),
      coverageOf,
    ),
  };
}

/** The stored TestChunks of one file that carry this test name: the ones a coverage record's lookup by file and name can land on. */
export function chunksNamed(
  { chunks }: StoredTestLayer,
  file: string,
  name: string,
): StoredTestChunk[] {
  return [...chunks.values()].filter(
    (chunk) => chunk.file === file && chunk.name === name,
  );
}

function chunkOf(row: Record<string, unknown>): StoredTestChunk {
  return {
    uid: String(row["uid"]),
    ...stringField("name", row["name"]),
    ...stringField("file", row["file"]),
    ...numberField("start", row["start"]),
    ...numberField("end", row["end"]),
    ...stringField("suiteUid", firstUid(row["suite"])),
    coverageUids: edgeRows(row["coverage"]).map((cover) =>
      String(cover["uid"]),
    ),
  };
}

function suiteOf(row: Record<string, unknown>): StoredSuite {
  return {
    uid: String(row["uid"]),
    ...stringField("name", row["name"]),
    ...stringField("file", row["file"]),
    ...stringField("parentUid", firstUid(row["parent"])),
  };
}

function coverageOf(row: Record<string, unknown>): StoredCoverage {
  return {
    uid: String(row["uid"]),
    ...stringField("tool", row["tool"]),
    ...stringField("commit", row["commit"]),
    covers: new Map(edgeRows(row["Coverage.covers"]).flatMap(coverOf)),
  };
}

function coverOf(row: Record<string, unknown>): [string, StoredCover][] {
  const path = row["path"];

  if (typeof path !== "string") {
    return [];
  }

  return [
    [
      path,
      {
        uid: String(row["uid"]),
        ...stringField("ranges", row["Coverage.covers|ranges"]),
      },
    ],
  ];
}

function byXid<T>(
  rows: Record<string, unknown>[],
  parse: (row: Record<string, unknown>) => T,
): ReadonlyMap<string, T> {
  return new Map(
    rows.flatMap((row) =>
      typeof row["xid"] === "string" ? [[row["xid"], parse(row)]] : [],
    ),
  );
}

function firstUid(value: unknown): string | undefined {
  const uid = edgeRows(value).at(0)?.["uid"];

  return typeof uid === "string" ? uid : undefined;
}

function stringField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  return typeof value === "string"
    ? ({ [key]: value } as Record<K, string>)
    : {};
}

function numberField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, number>> {
  return typeof value === "number"
    ? ({ [key]: value } as Record<K, number>)
    : {};
}
