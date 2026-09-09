import {
  fetchGraphContext,
  type GraphContextBlock,
  type GraphContextStatement,
} from "../../spec-trace/graph-context.js";
import type { DgraphClientPort } from "../../memory-store.js";
import type { SourceItem } from "./context-assembly-format.js";
import type { FetchResult } from "./context-assembly-types.js";
import { mkItem, extractKeyTerms } from "./context-assembly-items.js";

/** The coupling context source: projects the spec-traceability graph into ranked context items. */

// Coupled-statement signal → relevance score, so violations/drift sort to the top.
const COUPLING_SIGNAL_SCORE: Record<string, number> = {
  violated: 1.0,
  drifted: 0.66,
  untested: 0.33,
  normal: 0.1,
};

/** Project a spec-traceability GraphContextBlock into context sources, keeping only the statements the query actually names — the deterministic "what spec rules + tests govern this code" signal vector search can't produce. Severity orders what survives; it does not decide what survives, or the most-violated statements in the repo would ride along in every bundle regardless of the question. */
export function formatCouplingItems(
  block: GraphContextBlock,
  query: string,
): SourceItem[] {
  const terms = extractKeyTerms(query, 8).map((term) => term.toLowerCase());

  return block.statements.flatMap((statement) => {
    const relevance = couplingRelevance(statement, terms);

    return relevance > 0 ? [couplingItem(statement, relevance)] : [];
  });
}

/** The share of the query's distinctive terms this statement mentions. A query left with no distinctive terms cannot discriminate, so everything scores 1 rather than nothing surviving. */
function couplingRelevance(s: GraphContextStatement, terms: string[]): number {
  if (terms.length === 0) {
    return 1;
  }
  const text = haystack(s);

  return terms.filter((term) => text.includes(term)).length / terms.length;
}

/** Everything about a statement a query could plausibly name: its prose, where it lives, and what tests it. */
function haystack(s: GraphContextStatement): string {
  return [
    s.specPath,
    s.specTitle,
    s.section,
    s.statementText,
    ...s.testSelectors,
  ]
    .join(" ")
    .toLowerCase();
}

function couplingItem(s: GraphContextStatement, relevance: number): SourceItem {
  const head = `[${s.signal}] ${s.specPath}${s.section ? ` › ${s.section}` : ""} — ${s.statementText}`;
  const adrLabels = s.adrs.map((a) => a.label);
  const gov = adrLabels.length
    ? `\n  governed by: ${adrLabels.join(", ")}`
    : "";
  const tests = s.testSelectors.length
    ? `\n  tested by: ${s.testSelectors.join(", ")}`
    : "";

  return mkItem(head + gov + tests, {
    source_path: s.specPath,
    content_type: "coupling",
    score: (COUPLING_SIGNAL_SCORE[s.signal] ?? 0) * relevance,
  });
}

/** Coupling context source: reads the repo's coupled spec statements from the spec-traceability graph. Fail-soft — `disabled` when no graph client is wired (LORE_DGRAPH_HTTP unset). */
export async function fetchCouplingSource(
  dgraph: DgraphClientPort | null,
  repo?: string,
  query: string = "",
): Promise<FetchResult> {
  if (!dgraph || !repo) {
    return { sources: [], status: "disabled" };
  }

  try {
    const block = await fetchGraphContext(dgraph, repo);
    const sources = formatCouplingItems(block, query);

    return { sources, status: sources.length > 0 ? "ok" : "empty" };
  } catch {
    return { sources: [], status: "error" };
  }
}
