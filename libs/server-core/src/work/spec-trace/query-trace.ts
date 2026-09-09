/** Formats TraceDocument into agent-readable text (summary or focused view with links). */

import type {
  TraceDocument,
  TraceStatement,
  TraceLinkRef,
  CoveringTest,
  FailureHit,
} from "@re-cinq/lore-shared";
import type { ProxyResult } from "../../outbound/proxy.js";

export function formatTraceQuery(
  doc: TraceDocument,
  selector?: string,
): string {
  if (!selector?.trim()) {
    return summary(doc);
  }
  const matches = selectStatements(doc, selector);

  if (matches.length === 0) {
    return `No statement in ${doc.filePath} matches "${selector}".`;
  }

  return matches.map(detail).join("\n\n");
}

function summary(doc: TraceDocument): string {
  if (doc.statements.length === 0) {
    return `No graph data for ${doc.filePath} (not ingested, or the graph is empty on main).`;
  }
  const { testable, covered, ratio } = doc.coverage;
  const lines = [
    `# ${doc.title || doc.filePath}`,
    `Coverage: ${covered}/${testable} testable (${Math.round(ratio * 100)}%)`,
  ];

  lines.push(...attentionSection(doc));

  return lines.join("\n");
}

// Worst first: sorted by SIGNAL then ordinal, so a violated statement outranks a merely untested one wherever it sits in the document.
function attentionSection(doc: TraceDocument): string[] {
  const flagged = doc.statements.filter((s) => signalRank(s) < 3);

  if (flagged.length === 0) {
    return ["", "No violated, drifted, or untested statements."];
  }
  const worstFirst = [...flagged].sort(
    (a, b) => signalRank(a) - signalRank(b) || a.ordinal - b.ordinal,
  );

  return [
    "",
    "Needs attention:",
    ...worstFirst.map((s) => `- [${attentionTag(s)}] #${s.ordinal} ${s.text}`),
  ];
}

function attentionTag(statement: TraceStatement): string {
  if (statement.violated) {
    return "violated";
  }

  if (statement.drifted) {
    return "drifted";
  }

  return "untested";
}

/** Signal priority for the summary — the collisions worth surfacing first. */
function signalRank(s: TraceStatement): number {
  if (s.violated) {
    return 0;
  }

  if (s.drifted) {
    return 1;
  }

  if (s.state === "untested") {
    return 2;
  }

  return 3;
}

/** A statement matches when the selector equals its ordinal, else case-insensitive substring of its text. */
function selectStatements(
  doc: TraceDocument,
  selector: string,
): TraceStatement[] {
  const byOrdinal = doc.statements.filter(
    (s) => String(s.ordinal) === selector.trim(),
  );

  if (byOrdinal.length) {
    return byOrdinal;
  }
  const needle = selector.trim().toLowerCase();

  return doc.statements.filter((s) => includesCaseless(s.text, needle));
}

function includesCaseless(text: string, lowerNeedle: string): boolean {
  return text.toLowerCase().includes(lowerNeedle);
}

function detail(statement: TraceStatement): string {
  return [
    statementHeader(statement),
    statement.text,
    ...linkSections(statement),
  ].join("\n");
}

// Flags are ADDITIVE to the state, never replacing it — a covered statement that has since drifted is still covered, and hiding that would misreport the coverage figure.
function statementHeader(statement: TraceStatement): string {
  const flags = [
    statement.violated && "⚠ violated",
    statement.drifted && "⚠ drifted",
  ].filter(Boolean);

  return `#${statement.ordinal} (${statement.state}${flags.length ? `, ${flags.join(", ")}` : ""})`;
}

// In the order a reader asks: what proves it, what implements it, what decided it. An empty kind is omitted rather than shown as a heading with nothing under it.
function linkSections(statement: TraceStatement): string[] {
  const groups: Array<[TraceLinkRef["kind"], string]> = [
    ["test", "validated by"],
    ["code", "implemented by"],
    ["adr", "decided by"],
  ];
  const out: string[] = [];

  for (const [kind, heading] of groups) {
    const links = statement.links.filter((l) => l.kind === kind);

    if (links.length > 0) {
      out.push("", `${heading}:`, ...links.map((l) => `- ${linkLine(l)}`));
    }
  }

  return out;
}

/** Renders one link as `path:line — detail`, omitting the parts it lacks. */
function linkLine(link: TraceLinkRef): string {
  const loc = link.path
    ? `${link.path}${link.line ? `:${link.line}` : ""}`
    : link.label;

  return link.detail ? `${loc} — ${link.detail}` : loc;
}

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
  /** Reads that run's branch overlay instead of main. */
  assembly_run_id?: string;
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
  const symbol = encodeURIComponent(
    (args.callers_of ?? args.callees_of) as string,
  );
  const direction = args.callers_of ? "callers" : "callees";
  const result = await deps.proxyGet(
    `/api/repos/${repo}/trace/callers?symbol=${symbol}&direction=${direction}&depth=${args.depth ?? 1}`,
  );

  return result.ok ? result.body : formatProxyFailure(result);
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

/** Which tests exercise a source span — the run's branch overlay when `assembly_run_id` is given, else main. */
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

  if (args.assembly_run_id) {
    params.set("assemblyRunId", args.assembly_run_id);
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
