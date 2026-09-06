import {
  fetchGraphContext,
  type GraphContextBlock,
} from "../../spec-trace/graph-context.js";
import type { DgraphClientPort } from "../../memory-store.js";
import type { SourceItem } from "./context-assembly-format.js";
import type { FetchResult } from "./context-assembly-types.js";
import { mkItem } from "./context-assembly-items.js";

/** The coupling context source: projects the spec-traceability graph into ranked context items. */

// Coupled-statement signal → relevance score, so violations/drift sort to the top.
const COUPLING_SIGNAL_SCORE: Record<string, number> = {
  violated: 1.0,
  drifted: 0.66,
  untested: 0.33,
  normal: 0.1,
};

/** Project a spec-traceability GraphContextBlock into context sources — the deterministic "what spec rules + tests govern this code" signal vector search can't produce. */
export function formatCouplingItems(block: GraphContextBlock): SourceItem[] {
  return block.statements.map((s) => {
    const head = `[${s.signal}] ${s.specPath}${s.section ? ` › ${s.section}` : ""} — ${s.statementText}`;
    const gov = s.adrs.length
      ? `\n  governed by: ${s.adrs.map((a) => a.label).join(", ")}`
      : "";
    const tests = s.testSelectors.length
      ? `\n  tested by: ${s.testSelectors.join(", ")}`
      : "";

    return mkItem(head + gov + tests, {
      source_path: s.specPath,
      content_type: "coupling",
      score: COUPLING_SIGNAL_SCORE[s.signal] ?? 0,
    });
  });
}

/** Coupling context source: reads the repo's coupled spec statements from the spec-traceability graph. Fail-soft — `disabled` when no graph client is wired (LORE_DGRAPH_HTTP unset). */
export async function fetchCouplingSource(
  dgraph: DgraphClientPort | null,
  repo?: string,
): Promise<FetchResult> {
  if (!dgraph || !repo) {
    return { sources: [], status: "disabled" };
  }

  try {
    const block = await fetchGraphContext(dgraph, repo);
    const sources = formatCouplingItems(block);

    return { sources, status: sources.length > 0 ? "ok" : "empty" };
  } catch {
    return { sources: [], status: "error" };
  }
}
