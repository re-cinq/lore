/** What a test report's nodes already hold in the graph, read once per report (read-stored-test-layer.ts), so a suite, test or coverage the graph holds exactly as the report would write it is not written again: re-sending an unchanged suite costs one read instead of about twenty requests a test. Anything the read cannot vouch for is written as before. */

import type {
  CoveredChunk,
  TestDescriptor,
} from "../../outbound/spec-trace/deps.js";
import {
  scopedXid,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import {
  fileScopedTestChunkXid,
  suiteLevelXid,
  testChunkXid,
} from "./test-chunk-identity.js";

/** A stored TestChunk, as far as deciding to skip it needs. */
export interface StoredTestChunk {
  uid: string;
  repo?: string;
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
  repo?: string;
  name?: string;
  file?: string;
  parentUid?: string;
}

/** One file a stored Coverage covers: the File node, its xid and repo, and the ranges facet on the edge to it. */
export interface StoredCover {
  uid: string;
  xid?: string;
  repo?: string;
  ranges?: string;
}

/** A stored Coverage node with the files it covers keyed by path; `wellFormed` is false when a covered file has no path or xid, its edge carries a facet besides ranges, or two share a path. */
export interface StoredCoverage {
  uid: string;
  repo?: string;
  tool?: string;
  commit?: string;
  covers: ReadonlyMap<string, StoredCover>;
  wellFormed: boolean;
}

/** What the graph holds for one report: its TestChunks, TestSuites, Coverage and covered File nodes by xid, each only when one node holds the xid; the TestChunks of its files in its scope, which a coverage record's lookup by file and name searches; and the file-and-name keys the report creates or moves a TestChunk under. */
export interface StoredTestLayer {
  chunks: ReadonlyMap<string, StoredTestChunk>;
  suites: ReadonlyMap<string, StoredSuite>;
  coverage: ReadonlyMap<string, StoredCoverage>;
  sources: ReadonlyMap<string, string>;
  holders: StoredTestChunk[];
  touched: ReadonlySet<string>;
}

/** Nothing stored: a coverage-only payload, a report never ingested, or a read that failed, writes every node. */
export const NO_STORED_TESTS: StoredTestLayer = {
  chunks: new Map(),
  suites: new Map(),
  coverage: new Map(),
  sources: new Map(),
  holders: [],
  touched: new Set(),
};

/** The xids a report's writes would look up, and its test files. */
export interface LayerKeys {
  files: string[];
  chunks: string[];
  suites: string[];
  coverage: string[];
  sources: string[];
}

/** What the ingest would write for one suite level. */
export interface PlannedSuite {
  repo: string;
  name: string | undefined;
  file: string;
  parentUid: string | undefined;
}

/** What the ingest would write for one TestChunk. */
export interface PlannedChunk {
  repo: string;
  name: string;
  file: string;
  start?: number;
  end?: number;
  suiteUid?: string;
}

/** What the ingest would write for one Coverage node: its repo and tool, and per covered path the ranges and the xid of the File node it points at. */
export interface PlannedCoverage {
  repo: string;
  tool: string;
  covers: ReadonlyMap<string, { ranges: string; fileXid: string }>;
}

/** What a coverage record's skip also depends on: the File nodes by xid, and the TestChunks its lookup by file and name could land on, undefined when the report writes a TestChunk under that name. */
export interface CoverageContext {
  sources: ReadonlyMap<string, string>;
  holders: StoredTestChunk[] | undefined;
}

/** A coverage record as the coverage ingest consumes it. */
interface CoverageRecordKeys {
  testFile: string;
  testName: string;
  covered: CoveredChunk[];
}

/** True when the graph holds this suite level as the ingest would write it; a name or parent the upsert would not write is no change. */
export function isSuiteUnchanged(
  stored: StoredSuite | undefined,
  planned: PlannedSuite,
): boolean {
  return (
    stored !== undefined &&
    stored.repo === planned.repo &&
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
    sameIdentity(stored, planned) &&
    writtenMatches(stored.start, planned.start) &&
    writtenMatches(stored.end, planned.end) &&
    writtenMatches(stored.suiteUid, planned.suiteUid)
  );
}

/** True when the graph holds this coverage as the ingest would write it: the same repo and tool, the same ranges on the same File nodes an upsert would find, and the one test its record names pointing at it alone. */
export function isCoverageUnchanged(
  stored: StoredCoverage | undefined,
  planned: PlannedCoverage,
  { sources, holders }: CoverageContext,
): boolean {
  return (
    stored !== undefined &&
    stored.repo === planned.repo &&
    stored.tool === planned.tool &&
    sameCovers(stored, planned, sources) &&
    holders !== undefined &&
    pointsAtItAlone(holders, stored.uid)
  );
}

function sameIdentity(
  stored: Pick<StoredTestChunk, "repo" | "file" | "name">,
  planned: { repo: string; file: string; name: string },
): boolean {
  return (
    stored.repo === planned.repo &&
    stored.file === planned.file &&
    stored.name === planned.name
  );
}

function writtenMatches<T>(
  stored: T | undefined,
  planned: T | undefined,
): boolean {
  return planned === undefined || stored === planned;
}

function sameCovers(
  stored: StoredCoverage,
  planned: PlannedCoverage,
  sources: ReadonlyMap<string, string>,
): boolean {
  return (
    stored.wellFormed &&
    stored.covers.size === planned.covers.size &&
    [...planned.covers].every(([path, wanted]) =>
      sameCover(
        stored.covers.get(path),
        { ...wanted, repo: planned.repo },
        sources,
      ),
    )
  );
}

function sameCover(
  cover: StoredCover | undefined,
  { ranges, fileXid, repo }: { ranges: string; fileXid: string; repo: string },
  sources: ReadonlyMap<string, string>,
): boolean {
  return (
    cover !== undefined &&
    cover.ranges === ranges &&
    cover.xid === fileXid &&
    cover.repo === repo &&
    sources.get(fileXid) === cover.uid
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

/** The TestChunks a coverage record's lookup by file and name can land on, or undefined when the report creates or moves a TestChunk under that name, so the read cannot say where the lookup lands after the report's writes. */
export function holdersOf(
  layer: StoredTestLayer,
  file: string,
  name: string,
): StoredTestChunk[] | undefined {
  if (layer.touched.has(nameKey(file, name))) {
    return undefined;
  }

  return layer.holders.filter(
    (chunk) => chunk.file === file && chunk.name === name,
  );
}

/** One TestChunk the report writes: its xid and the repo, file and name it gives it. */
interface NamedChunk {
  xid: string;
  repo: string;
  file: string;
  name: string;
}

/** The layer with every file-and-name key marked that the report's TestChunk writes create or move: a test or file chunk the graph does not hold, or holds under another repo, file or name. */
export function withTouched(
  layer: StoredTestLayer,
  scope: TraceScope,
  tests: TestDescriptor[],
): StoredTestLayer {
  const keys = namedChunksOf(scope, tests).flatMap((chunk) =>
    touchedKeys(layer, chunk),
  );

  return { ...layer, touched: new Set(keys) };
}

function namedChunksOf(
  scope: TraceScope,
  tests: TestDescriptor[],
): NamedChunk[] {
  const repo = scope.key;
  const testChunks = tests.map((test) => ({
    xid: testChunkXid(scope, test.id),
    repo,
    file: test.file,
    name: test.name,
  }));
  const fileChunks = uniqueFiles(tests).map((file) => ({
    xid: fileScopedTestChunkXid(repo, file),
    repo,
    file,
    name: file,
  }));

  return [...testChunks, ...fileChunks];
}

function touchedKeys({ chunks }: StoredTestLayer, chunk: NamedChunk): string[] {
  const held = chunks.get(chunk.xid);

  if (held === undefined) {
    return [nameKey(chunk.file, chunk.name)];
  }

  return sameIdentity(held, chunk)
    ? []
    : [nameKey(chunk.file, chunk.name), heldKey(held)];
}

function heldKey(held: StoredTestChunk): string {
  return nameKey(held.file ?? "", held.name ?? "");
}

function nameKey(file: string, name: string): string {
  return JSON.stringify([file, name]);
}

/** Every xid the report's writes would look up, and its test files: the chunks of each test and file, every level of each suite chain, each coverage record's node, and each covered file's node. */
export function layerKeysOf(
  scope: TraceScope,
  tests: TestDescriptor[],
  records: CoverageRecordKeys[],
): LayerKeys {
  const files = uniqueFiles(tests);

  return {
    files,
    chunks: unique([
      ...tests.map((test) => testChunkXid(scope, test.id)),
      ...files.map((file) => fileScopedTestChunkXid(scope.key, file)),
    ]),
    suites: unique(tests.flatMap((test) => suiteXidsOf(scope, test))),
    coverage: unique(records.map((record) => coverageXidOf(scope, record))),
    sources: unique(records.flatMap((record) => sourceXidsOf(scope, record))),
  };
}

function suiteXidsOf(scope: TraceScope, test: TestDescriptor): string[] {
  return (test.suite ?? []).map((_, level) =>
    suiteLevelXid(scope, test, level),
  );
}

function coverageXidOf(scope: TraceScope, record: CoverageRecordKeys): string {
  return scopedXid(scope, record.testFile, record.testName);
}

function sourceXidsOf(scope: TraceScope, record: CoverageRecordKeys): string[] {
  return record.covered.map((range) => scopedXid(scope, range.file));
}

function uniqueFiles(tests: TestDescriptor[]): string[] {
  return unique(tests.map((test) => test.file));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
