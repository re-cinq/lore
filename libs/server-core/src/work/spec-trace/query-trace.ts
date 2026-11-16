import { formatTraceQuery } from "./query-trace-document.js";

export { formatTraceQuery };

import type {
  TraceDocument,
  CoveringTest,
  FailureHit,
} from "@re-cinq/lore-shared";
import type { ProxyResult } from "../../outbound/proxy.js";

export interface QueryTraceArgs {
  repo?: string;
  /** Optional: a call-graph query names a SYMBOL, not a spec, and never reads this. */
  spec?: string;
  statement?: string;
  callers_of?: string;
  callees_of?: string;
  depth?: number;
  /** Path of the COVERED source file — asks which tests exercise it, not which statements describe it. */
  tests_covering?: string;
  /** Path of a source file — asks what has already failed on it, and what fixed it. */
  failures_touching?: string;
  /** "10-20,30-40": narrows `tests_covering` to spans of that file. */
  ranges?: string;
  /** Reads that branch's overlay instead of main. */
  branch?: string;
}

export interface QueryTraceDeps {
  proxyGet: (path: string) => Promise<ProxyResult>;
  detectRepo: () => string | null;
}

/** Orchestrates query: resolves repo, proxies GET for trace document, formats result (never throws). */
export async function runQueryTrace(
  args: QueryTraceArgs,
  deps: QueryTraceDeps,
): Promise<string> {
  const repo = args.repo || deps.detectRepo();

  if (!repo) {
    return "Could not detect the current repo — run inside a git repo or pass `repo` (owner/repo).";
  }

  return routeQuery(repo, args, deps);
}

/** One branch per question the tool can be asked: what has failed here, what covers here, who calls this, or what does this spec claim. */
function routeQuery(
  repo: string,
  args: QueryTraceArgs,
  deps: QueryTraceDeps,
): Promise<string> {
  if (args.failures_touching) {
    return failuresTouchingQuery(repo, args, deps);
  }

  if (args.tests_covering) {
    return testsCoveringQuery(repo, args, deps);
  }

  return args.callers_of || args.callees_of
    ? callGraphQuery(repo, args, deps)
    : documentQuery(repo, args, deps);
}

/** Walks the call graph outward from one symbol. It names no spec, which is why `spec` is optional. */
async function callGraphQuery(
  repo: string,
  args: QueryTraceArgs,
  deps: QueryTraceDeps,
): Promise<string> {
  const symbolName = (args.callers_of ?? args.callees_of) as string;
  const symbol = encodeURIComponent(symbolName);
  const direction = args.callers_of ? "callers" : "callees";
  const result = await deps.proxyGet(
    `/api/repos/${repo}/trace/callers?symbol=${symbol}&direction=${direction}&depth=${args.depth ?? 1}`,
  );

  if (!result.ok) {
    return formatProxyFailure(result);
  }

  const { callers } = JSON.parse(result.body) as {
    callers: Array<{ filePath: string; symbol: string; startLine: number }>;
  };

  return formatCallers(callers, symbolName);
}

function formatCallers(
  callers: Array<{ filePath: string; symbol: string; startLine: number }>,
  symbolName: string,
): string {
  if (callers.length === 0) {
    return `No callers found for ${symbolName}.`;
  }

  return [
    `Callers of ${symbolName} (${callers.length}):`,
    ...callers.map((c) => `- ${c.filePath}:${c.startLine} — ${c.symbol}`),
  ].join("\n");
}

/** Reads one spec's traceability document. */
async function documentQuery(
  repo: string,
  args: QueryTraceArgs,
  deps: QueryTraceDeps,
): Promise<string> {
  if (!args.spec) {
    return "Pass `spec` (a path under specs/) or a symbol via `callers_of`/`callees_of`.";
  }
  const result = await deps.proxyGet(
    `/api/repos/${repo}/trace/document?path=${encodeURIComponent(args.spec)}`,
  );

  if (!result.ok) {
    return formatProxyFailure(result);
  }

  return formatTraceQuery(
    JSON.parse(result.body) as TraceDocument,
    args.statement,
  );
}

function formatProxyFailure(
  result: Extract<ProxyResult, { ok: false }>,
): string {
  if (result.reason === "not_configured") {
    return "lore-query-trace needs LORE_API_URL + a read-scoped LORE_INGEST_TOKEN to reach the graph; neither is configured.";
  }
  const scopeHint = result.detail.includes("403")
    ? " — the token needs `read` scope for trace queries."
    : "";

  return `Lore API unreachable for lore-query-trace: ${result.detail}.${scopeHint}`;
}

/** Which tests exercise a source span — that branch's overlay when `branch` is given, else main. */
async function testsCoveringQuery(
  repo: string,
  args: QueryTraceArgs,
  deps: QueryTraceDeps,
): Promise<string> {
  const result = await deps.proxyGet(
    `/api/repos/${repo}/trace/tests-covering?${coveringParams(args)}`,
  );

  if (!result.ok) {
    return formatProxyFailure(result);
  }
  const { tests } = JSON.parse(result.body) as { tests: CoveringTest[] };

  return formatCoveringTests(tests, coverageLabel(args));
}

/** The covered path plus the optional range/overlay narrowing, every value URL-encoded. */
function coveringParams(args: QueryTraceArgs): string {
  const params = new URLSearchParams({ path: args.tests_covering ?? "" });

  if (args.ranges) {
    params.set("ranges", args.ranges);
  }

  if (args.branch) {
    params.set("branch", args.branch);
  }

  return params.toString();
}

/** Names what was asked about, for both the summary line and the empty answer. */
function coverageLabel(args: QueryTraceArgs): string {
  return args.ranges
    ? `${args.tests_covering} (lines ${args.ranges})`
    : `${args.tests_covering}`;
}

// An empty list is an ANSWER — "nothing covers this" is the signal a red round needs — so it gets a sentence, never an empty string.
function formatCoveringTests(tests: CoveringTest[], label: string): string {
  if (tests.length === 0) {
    return `No tests cover ${label}.`;
  }

  return [`Tests covering ${label}:`, ...tests.map(coveringLine)].join("\n");
}

/** One test file: the statement it validates when it declares one, and whether the overlay answered. */
function coveringLine(test: CoveringTest): string {
  const validates = test.statement
    ? `validates: "${test.statement}"`
    : "unlinked";
  const overlay = test.origin === "overlay" ? " (overlay)" : "";

  return `- ${test.testFile} — ${validates}${overlay}`;
}

/** What has already failed on this file — the question `fix-ci` asks before starting cold. */
async function failuresTouchingQuery(
  repo: string,
  args: QueryTraceArgs,
  deps: QueryTraceDeps,
): Promise<string> {
  const path = args.failures_touching ?? "";
  const result = await deps.proxyGet(
    `/api/repos/${repo}/trace/failures-touching?path=${encodeURIComponent(path)}`,
  );

  if (!result.ok) {
    return formatProxyFailure(result);
  }
  const { failures } = JSON.parse(result.body) as { failures: FailureHit[] };

  return formatFailures(failures, path);
}

// A clean file is an ANSWER — "nothing has failed here" is what tells the caller its breakage is new — so it gets a sentence, never an empty string.
function formatFailures(hits: FailureHit[], path: string): string {
  if (hits.length === 0) {
    return `No recorded failures on ${path}.`;
  }

  return [
    `Failures recorded on ${path} (${hits.length}), newest first:`,
    ...hits.map(failureLine),
  ].join("\n");
}

/** One failure condensed to a recognizable line: what failed, on which attempt, and whether anything ever ended it. */
function failureLine(hit: FailureHit): string {
  const status = hit.resolvedByCommit
    ? `fixed by ${hit.resolvedByCommit}`
    : "still open";

  return `- [${hit.failureClass}] ${hit.nodeId} #${hit.iteration} at ${hit.commit} — ${detailPreview(hit.failureDetail)} — ${status}`;
}

/** The detail's first line, capped — recognition needs the opening message; the rest is in the run's pod logs. */
function detailPreview(detail: string): string {
  const [opening = ""] = detail.split("\n");
  const line = opening.trim();

  if (!line) {
    return "(no detail)";
  }

  return line.length > DETAIL_PREVIEW_MAX
    ? `${line.slice(0, DETAIL_PREVIEW_MAX)}…`
    : line;
}

const DETAIL_PREVIEW_MAX = 120;
