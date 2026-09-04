/** Formats TraceDocument into agent-readable text (summary or focused view with links). */

import type {
  TraceDocument,
  TraceStatement,
  TraceLinkRef,
} from "@re-cinq/lore-shared";
import type { ProxyResult } from "../../proxy.js";

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

function summary(doc: TraceDocument): string {
  if (doc.statements.length === 0) {
    return `No graph data for ${doc.filePath} (not ingested, or the graph is empty on main).`;
  }
  const { testable, covered, ratio } = doc.coverage;
  const lines = [
    `# ${doc.title || doc.filePath}`,
    `Coverage: ${covered}/${testable} testable (${Math.round(ratio * 100)}%)`,
  ];
  const flagged = doc.statements
    .filter((s) => signalRank(s) < 3)
    .sort((a, b) => signalRank(a) - signalRank(b) || a.ordinal - b.ordinal);

  if (flagged.length === 0) {
    lines.push("", "No violated, drifted, or untested statements.");

    return lines.join("\n");
  }
  lines.push("", "Needs attention:");

  for (const s of flagged) {
    lines.push(`- [${attentionTag(s)}] #${s.ordinal} ${s.text}`);
  }

  return lines.join("\n");
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

/** Renders one link as `path:line — detail`, omitting the parts it lacks. */
function linkLine(link: TraceLinkRef): string {
  const loc = link.path
    ? `${link.path}${link.line ? `:${link.line}` : ""}`
    : link.label;

  return link.detail ? `${loc} — ${link.detail}` : loc;
}

function detail(statement: TraceStatement): string {
  const flags = [
    statement.violated && "⚠ violated",
    statement.drifted && "⚠ drifted",
  ].filter(Boolean);
  const lines = [
    `#${statement.ordinal} (${statement.state}${flags.length ? `, ${flags.join(", ")}` : ""})`,
    statement.text,
  ];
  const groups: Array<[TraceLinkRef["kind"], string]> = [
    ["test", "validated by"],
    ["code", "implemented by"],
    ["adr", "decided by"],
  ];

  for (const [kind, heading] of groups) {
    const links = statement.links.filter((l) => l.kind === kind);

    if (links.length === 0) {
      continue;
    }
    lines.push(
      "",
      `${heading}:`,
      ...links.map((link) => `- ${linkLine(link)}`),
    );
  }

  return lines.join("\n");
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

  return doc.statements.filter((s) => s.text.toLowerCase().includes(needle));
}

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

export interface QueryTraceArgs {
  repo?: string;
  spec: string;
  statement?: string;
}

export interface QueryTraceDeps {
  proxyGet: (path: string) => Promise<ProxyResult>;
  detectRepo: () => string | null;
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

/** Orchestrates query: resolves repo, proxies GET for trace document, formats result (never throws). */
export async function runQueryTrace(
  args: QueryTraceArgs,
  deps: QueryTraceDeps,
): Promise<string> {
  const repo = args.repo || deps.detectRepo();

  if (!repo) {
    return "Could not detect the current repo — run inside a git repo or pass `repo` (owner/repo).";
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
