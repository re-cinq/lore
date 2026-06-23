/**
 * query-trace — pure formatter for the `lore-query-trace` MCP tool. Turns a
 * TraceDocument (read from the spec-traceability graph via the remote
 * `/trace/document` route) into agent-readable text: a no-selector signal
 * summary, or a focused view of the selected statement(s) with their
 * validated_by / implemented_by / decided_by links. No IO — the tool handler
 * fetches; this projects the result.
 */

import type { TraceDocument, TraceStatement, TraceLinkRef } from "@re-cinq/lore-shared";
import type { ProxyResult } from "../../proxy.js";

/** Signal priority for the summary — the collisions worth surfacing first. */
function signalRank(s: TraceStatement): number {
  if (s.violated) return 0;
  if (s.drifted) return 1;
  if (s.state === "untested") return 2;
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
    const tag = s.violated ? "violated" : s.drifted ? "drifted" : "untested";
    lines.push(`- [${tag}] #${s.ordinal} ${s.text}`);
  }
  return lines.join("\n");
}

/** Renders one link as `path:line — detail`, omitting the parts it lacks. */
function linkLine(link: TraceLinkRef): string {
  const loc = link.path ? `${link.path}${link.line ? `:${link.line}` : ""}` : link.label;
  return link.detail ? `${loc} — ${link.detail}` : loc;
}

function detail(statement: TraceStatement): string {
  const flags = [statement.violated && "⚠ violated", statement.drifted && "⚠ drifted"].filter(Boolean);
  const lines = [`#${statement.ordinal} (${statement.state}${flags.length ? `, ${flags.join(", ")}` : ""})`, statement.text];
  const groups: Array<[TraceLinkRef["kind"], string]> = [
    ["test", "validated by"],
    ["code", "implemented by"],
    ["adr", "decided by"],
  ];
  for (const [kind, heading] of groups) {
    const links = statement.links.filter((l) => l.kind === kind);
    if (links.length === 0) continue;
    lines.push("", `${heading}:`);
    for (const link of links) lines.push(`- ${linkLine(link)}`);
  }
  return lines.join("\n");
}

/** A statement matches when the selector equals its ordinal, else case-insensitive substring of its text. */
function selectStatements(doc: TraceDocument, selector: string): TraceStatement[] {
  const byOrdinal = doc.statements.filter((s) => String(s.ordinal) === selector.trim());
  if (byOrdinal.length) return byOrdinal;
  const needle = selector.trim().toLowerCase();
  return doc.statements.filter((s) => s.text.toLowerCase().includes(needle));
}

export function formatTraceQuery(doc: TraceDocument, selector?: string): string {
  if (!selector?.trim()) return summary(doc);
  const matches = selectStatements(doc, selector);
  if (matches.length === 0) return `No statement in ${doc.filePath} matches "${selector}".`;
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

/**
 * Orchestrates the query: resolve the repo, proxy a GET for the spec's trace
 * document to the remote backend, and format the result. Returns text on every
 * path (never throws) — the proxy seam is injected so this is testable without
 * a network.
 */
export async function runQueryTrace(args: QueryTraceArgs, deps: QueryTraceDeps): Promise<string> {
  const repo = args.repo || deps.detectRepo();
  if (!repo) {
    return "Could not detect the current repo — run inside a git repo or pass `repo` (owner/repo).";
  }
  const result = await deps.proxyGet(`/api/repos/${repo}/trace/document?path=${encodeURIComponent(args.spec)}`);
  if (!result.ok && result.reason === "not_configured") {
    return "lore-query-trace needs LORE_API_URL + a read-scoped LORE_INGEST_TOKEN to reach the graph; neither is configured.";
  }
  if (!result.ok) {
    const scopeHint = result.detail.includes("403")
      ? " — the token needs `read` scope for trace queries."
      : "";
    return `Lore API unreachable for lore-query-trace: ${result.detail}.${scopeHint}`;
  }
  return formatTraceQuery(JSON.parse(result.body) as TraceDocument, args.statement);
}
