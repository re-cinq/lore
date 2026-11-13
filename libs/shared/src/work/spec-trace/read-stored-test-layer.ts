/** The one read a test report's ingest makes before writing: every node its writes would look up, each looked up the way that write looks it up (stored-test-layer.ts decides what to skip). */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import type { TraceScope } from "../../domain/spec-trace/trace-scope.js";
import {
  NO_STORED_TESTS,
  type LayerKeys,
  type StoredCover,
  type StoredCoverage,
  type StoredSuite,
  type StoredTestChunk,
  type StoredTestLayer,
} from "./stored-test-layer.js";
import { edgeRows } from "./uid-refs.js";

const LIST = "@@LIST@@";
const REPO = "@@REPO@@";

/** One block per kind of node: by xid alone for what an upsert finds, by file and scope for what the coverage link's lookup by file and name searches. */
const READ_BLOCKS: Record<keyof LayerKeys, string> = {
  files: `holders(func: eq(TestChunk.file_path, ${LIST})) @filter(eq(TestChunk.repo, ${REPO})) {
    uid name: TestChunk.test_name file: TestChunk.file_path coverage: TestChunk.coverage { uid }
  }`,
  chunks: `chunks(func: eq(TestChunk.xid, ${LIST})) {
    uid xid: TestChunk.xid repo: TestChunk.repo name: TestChunk.test_name file: TestChunk.file_path
    start: TestChunk.start_line end: TestChunk.end_line suite: TestChunk.suite { uid }
  }`,
  suites: `suites(func: eq(TestSuite.xid, ${LIST})) {
    uid xid: TestSuite.xid repo: TestSuite.repo name: TestSuite.name file: TestSuite.file_path parent: TestSuite.parent { uid }
  }`,
  coverage: `coverage(func: eq(Coverage.xid, ${LIST})) {
    uid xid: Coverage.xid repo: Coverage.repo tool: Coverage.tool commit: Coverage.commit
    Coverage.covers @facets { uid path: File.path xid: File.xid repo: File.repo }
  }`,
  sources: `sources(func: eq(File.xid, ${LIST})) { uid xid: File.xid }`,
};

/** One read of everything the report's writes would look up; a report with no tests reads nothing. */
export async function readStoredTestLayer(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  keys: LayerKeys,
): Promise<StoredTestLayer> {
  if (keys.chunks.length === 0) {
    return NO_STORED_TESTS;
  }

  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(storedTestLayerQuery(scope, keys), {});

    return storedTestLayerOf(res.data);
  });
}

/** The read as one DQL request holding a block for every kind the report has keys for. */
export function storedTestLayerQuery(
  scope: TraceScope,
  keys: LayerKeys,
): string {
  const kinds = (Object.keys(READ_BLOCKS) as (keyof LayerKeys)[]).filter(
    (kind) => keys[kind].length > 0,
  );
  const blocks = kinds.map((kind) => blockFor(kind, scope, keys[kind]));

  return `{\n  ${blocks.join("\n  ")}\n}`;
}

// DQL's eq takes a list of values but no list variable, so each value goes in as a JSON string, which DQL reads as a string literal; the replacers are functions so a `$` in a value is never read as a replacement pattern.
function blockFor(
  kind: keyof LayerKeys,
  scope: TraceScope,
  values: string[],
): string {
  const template = READ_BLOCKS[kind];
  const listed = template.replace(LIST, () => dqlList(values));

  return listed.replace(REPO, () => dqlString(scope.key));
}

function dqlList(values: string[]): string {
  const quoted = values.map(dqlString);

  return `[${quoted.join(", ")}]`;
}

function dqlString(value: string): string {
  return JSON.stringify(value);
}

/** The read's answer as maps by xid, keeping an xid only when one node holds it, so a duplicate is written as the upsert's own lookup would write it. */
export function storedTestLayerOf(
  answer: Record<string, unknown> | undefined,
): StoredTestLayer {
  return {
    chunks: byUniqueXid(edgeRows(answer?.["chunks"]), chunkOf),
    suites: byUniqueXid(edgeRows(answer?.["suites"]), suiteOf),
    coverage: byUniqueXid(edgeRows(answer?.["coverage"]), coverageOf),
    sources: byUniqueXid(edgeRows(answer?.["sources"]), uidOf),
    holders: edgeRows(answer?.["holders"]).map(chunkOf),
    touched: new Set(),
  };
}

function chunkOf(row: Record<string, unknown>): StoredTestChunk {
  return {
    uid: uidOf(row),
    ...stringField("repo", row["repo"]),
    ...stringField("name", row["name"]),
    ...stringField("file", row["file"]),
    ...numberField("start", row["start"]),
    ...numberField("end", row["end"]),
    ...stringField("suiteUid", firstUid(row["suite"])),
    coverageUids: edgeRows(row["coverage"]).map(uidOf),
  };
}

function suiteOf(row: Record<string, unknown>): StoredSuite {
  return {
    uid: uidOf(row),
    ...stringField("repo", row["repo"]),
    ...stringField("name", row["name"]),
    ...stringField("file", row["file"]),
    ...stringField("parentUid", firstUid(row["parent"])),
  };
}

function coverageOf(row: Record<string, unknown>): StoredCoverage {
  const rows = edgeRows(row["Coverage.covers"]);
  const covers = new Map(rows.flatMap(coverOf));

  return {
    uid: uidOf(row),
    ...stringField("repo", row["repo"]),
    ...stringField("tool", row["tool"]),
    ...stringField("commit", row["commit"]),
    covers,
    wellFormed: covers.size === rows.length,
  };
}

// A covered file without a path or xid, or whose edge carries a facet the ingest does not write, is left out, so its coverage reads as not well formed and is written as before.
function coverOf(row: Record<string, unknown>): [string, StoredCover][] {
  const { path, xid } = row;

  if (
    typeof path !== "string" ||
    typeof xid !== "string" ||
    hasForeignFacet(row)
  ) {
    return [];
  }

  return [[path, coverFields(row, xid)]];
}

function coverFields(row: Record<string, unknown>, xid: string): StoredCover {
  return {
    uid: uidOf(row),
    xid,
    ...stringField("repo", row["repo"]),
    ...stringField("ranges", row["Coverage.covers|ranges"]),
  };
}

function hasForeignFacet(row: Record<string, unknown>): boolean {
  return Object.keys(row).some(
    (key) =>
      key.startsWith("Coverage.covers|") && key !== "Coverage.covers|ranges",
  );
}

function byUniqueXid<T>(
  rows: Record<string, unknown>[],
  parse: (row: Record<string, unknown>) => T,
): ReadonlyMap<string, T> {
  const rowsByXid = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    const { xid } = row;

    if (typeof xid === "string") {
      rowsByXid.set(xid, [...(rowsByXid.get(xid) ?? []), row]);
    }
  }

  return new Map(
    [...rowsByXid].flatMap(([xid, held]) =>
      held.length === 1 ? held.map((row) => [xid, parse(row)] as const) : [],
    ),
  );
}

function uidOf(row: Record<string, unknown>): string {
  return String(row["uid"]);
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
