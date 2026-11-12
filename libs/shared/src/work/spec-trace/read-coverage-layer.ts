/** Coverage-only stored-layer read: fetches all Coverage nodes for a scope without requiring TestChunk keys. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import type { TraceScope } from "../../domain/spec-trace/trace-scope.js";
import type {
  StoredCover,
  StoredCoverage,
  StoredTestLayer,
} from "./stored-test-layer.js";
import { edgeRows } from "./uid-refs.js";

const COVERAGE_QUERY = `query q($repo: string) { coverage(func: eq(Coverage.repo, $repo)) { uid xid: Coverage.xid repo: Coverage.repo tool: Coverage.tool commit: Coverage.commit Coverage.covers @facets { uid path: File.path xid: File.xid repo: File.repo } } }`;

export async function readStoredTestLayer(
  dgraph: DgraphClientPort,
  scope: TraceScope,
): Promise<StoredTestLayer> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(COVERAGE_QUERY, { $repo: scope.key });

    return parseCoverageData(res.data as Record<string, unknown> | undefined);
  });
}

function parseCoverageData(
  answer: Record<string, unknown> | undefined,
): StoredTestLayer {
  const rows = edgeRows(answer?.["coverage"]);
  const coverage = new Map<string, StoredCoverage>();
  const sources = new Map<string, string>();

  for (const row of rows) {
    addCoverageRow(row, coverage, sources);
  }

  return {
    chunks: new Map(),
    suites: new Map(),
    coverage,
    sources,
    holders: [],
    touched: new Set(),
  };
}

function addCoverageRow(
  row: Record<string, unknown>,
  coverage: Map<string, StoredCoverage>,
  sources: Map<string, string>,
): void {
  const xid = str(row["xid"]);

  if (!xid || coverage.has(xid)) {
    return;
  }

  const coverRows = edgeRows(row["Coverage.covers"]);
  const covers = parseCoverRows(coverRows, sources);

  coverage.set(xid, {
    uid: String(row["uid"]),
    ...(str(row["repo"]) ? { repo: str(row["repo"]) } : {}),
    ...(str(row["tool"]) ? { tool: str(row["tool"]) } : {}),
    ...(str(row["commit"]) ? { commit: str(row["commit"]) } : {}),
    covers,
    wellFormed: covers.size === coverRows.length,
  });
}

function parseCoverRows(
  rows: Record<string, unknown>[],
  sources: Map<string, string>,
): ReadonlyMap<string, StoredCover> {
  const covers = new Map<string, StoredCover>();

  for (const cr of rows) {
    const cover = parseCover(cr);

    if (!cover) {
      continue;
    }
    covers.set(cover.path, cover.stored);
    sources.set(cover.stored.xid!, cover.stored.uid);
  }

  return covers;
}

function parseCover(
  cr: Record<string, unknown>,
): { path: string; stored: StoredCover } | undefined {
  const path = str(cr["path"]);
  const fileXid = str(cr["xid"]);

  if (!path || !fileXid) {
    return undefined;
  }

  if (hasForeignCoverFacet(cr)) {
    return undefined;
  }

  return { path, stored: coverFields(cr, fileXid) };
}

function coverFields(
  cr: Record<string, unknown>,
  fileXid: string,
): StoredCover {
  return {
    uid: String(cr["uid"]),
    xid: fileXid,
    ...(str(cr["repo"]) ? { repo: str(cr["repo"]) } : {}),
    ...(str(cr["Coverage.covers|ranges"])
      ? { ranges: str(cr["Coverage.covers|ranges"]) }
      : {}),
  };
}

function hasForeignCoverFacet(cr: Record<string, unknown>): boolean {
  return Object.keys(cr).some(
    (key) =>
      key.startsWith("Coverage.covers|") && key !== "Coverage.covers|ranges",
  );
}

function str(raw: unknown): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}
