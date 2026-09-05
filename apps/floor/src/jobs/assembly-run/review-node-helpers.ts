// Shared identity helpers for the review-post and reply-post paths: which PR a node targets, whether its prompt_ref is review-shaped, and the poster/marker plumbing both paths dedupe against.

import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { reviewRunMarker, type ReviewPoster } from "../review/post-review.js";
import { projectFor } from "../../kernel/project-boot.js";

// Prompt refs whose nodes emit the REVIEW_FINDINGS + REVIEW_RESULT contract: the deep review on PR open and the fast re-check on every push, both posted through the same path.
export const REVIEW_PROMPT_REFS = new Set([
  "code-review",
  "code-review-recheck",
]);

export function prNumberFromRow(row: AssemblyRunRecord): number {
  return Number(row.args.pr_number) || 0;
}

export function reviewPromptApplies(
  node: RunGraphNode,
  prNumber: number,
): boolean {
  return REVIEW_PROMPT_REFS.has(node.prompt_ref ?? "") && prNumber > 0;
}

export async function resolvePoster(
  row: AssemblyRunRecord,
  poster: ReviewPoster | undefined,
): Promise<ReviewPoster> {
  return poster ?? (await projectFor(row.repo)).pulls;
}

export function reviewMarkerFor(
  row: AssemblyRunRecord,
  nodeId: string,
  iteration: number | undefined,
): string | undefined {
  return iteration === undefined
    ? undefined
    : reviewRunMarker(row.id, nodeId, iteration);
}

export function withReviewMarker(
  body: string,
  marker: string | undefined,
): string {
  return marker ? `${body}\n\n${marker}` : body;
}
