// detect node assembly line handler. A detect node runs a deterministic,
// repo-scoped detection job (DB + graph reads — spec-drift, gap-detect, coverage
// sweeps) inside the assembly-line walk, no repo checkout and no LLM prompting of
// its own. The detector registry is injected so this library never imports Floor
// job code; Floor composes { spec_drift: ({repo}) => specDriftJob({repoFilter: repo}), ... }.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  NodeHandler,
  NodeResult,
  NodeContext,
} from "./assembly-line-executor.js";
import type { AssemblyLineNode } from "./loader.js";

/** Runs one detection job against one repo; resolves to the run's summary line. */
export type DetectorFn = (input: { repo: string }) => Promise<string>;

export interface DetectRun {
  repo: string;
  /** Receives the untruncated summary (job_runs bookkeeping); the commit-trailer extra is capped. */
  onSummary?: (summary: string) => void;
}

/** Commit-trailer values ride in git trailers — cap them; the full summary goes to onSummary. */
export const DETECT_SUMMARY_MAX_CHARS = 200;

export function createDetectHandler(
  registry: Record<string, DetectorFn>,
  run: DetectRun,
): NodeHandler {
  return async (
    node: AssemblyLineNode,
    _ctx: NodeContext,
  ): Promise<NodeResult> => {
    const detector = node.job_ref ? registry[node.job_ref] : undefined;
    enforceTrue(
      detector,
      `detect node "${node.id}": no detector registered for job_ref "${node.job_ref}"`,
    );

    const summary = await detector({ repo: run.repo });
    run.onSummary?.(summary);
    return {
      outcome: "success",
      extras: {
        "Lore-Detect-Summary": summary.slice(0, DETECT_SUMMARY_MAX_CHARS),
      },
    };
  };
}
