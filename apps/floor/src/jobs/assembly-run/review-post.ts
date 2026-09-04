// Posting a review node's findings to the PR: a review node emits structured findings instead of posting them itself; render+post here — a review that computes findings and posts nothing must never go unaudited (both the throw and the silent no-parse are logged).

import {
  parseReviewVerdict,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { maybePostReview, type ReviewPoster } from "../review/post-review.js";
import { writeAuditLog } from "../lib/audit.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { commentablePositions } from "@re-cinq/lore-shared/review/diff-hunks.js";
import {
  prNumberFromRow,
  reviewPromptApplies,
  resolvePoster,
  reviewMarkerFor,
} from "./review-node-helpers.js";

// `iteration` keys the per-run dedupe marker (so a revisit still posts); unknown iteration skips marker+probe (fail open) rather than guessing `1`, which could suppress a revisit's real review.
export interface ReviewPorts {
  poster?: ReviewPoster;
  audit?: AuditPort;
  iteration?: number;
  /** Model(s) that billed against this visit; resolved by finishNodeTerminal. */
  model?: string;
}

// `already_posted` means the probe found this run's marker already on the PR (redelivered event or event-vs-reaper race), so nothing was re-posted.
export type ReviewPostOutcome =
  "posted" | "already_posted" | "no_findings" | "post_failed" | "not_review";

// The outage shape: review published nothing but the CR exited 0, so a bare `success` would finish the line green ("Approved." on an unreviewed PR) — `no_findings` with a `changes_requested` verdict is what #1401 was (JSON.parse died on unescaped quotes, findings lost, check green); the event handler's `agentCrVisible` guard keeps an unreadable CR from ever reaching this judgment.
export function reviewNodeResultOverride(
  post: ReviewPostOutcome,
  output: string | undefined,
  result: NodeResult,
): NodeResult {
  // Defer to a caller that already classified the failure — the reaper's timeout doors arrive with no output, which otherwise reads exactly like "ran and published nothing" and misrecords an evicted pod as a recipe/contract bug.
  if (result.failureClass) {
    return result;
  }

  if (post === "no_findings" && parseReviewVerdict(output) !== "success") {
    // Records WHY, not just that it failed — a bare failure renders identically to an evicted pod/dry account/token mismatch and cost two reviewers a false infra-outage hunt on 2026-08-24.
    const verdict = parseReviewVerdict(output);

    return {
      outcome: "failed",
      // `unknown`, not an invented class: FailureCategory is the closed taxonomy of infra failures driving retry/dispatch gating; this is a recipe/contract bug, and node-outcome already uses `unknown` for that.
      failureClass: "unknown",
      failureDetail:
        verdict === "changes_requested"
          ? "the review reached changes_requested but nothing was posted to the PR — its findings block did not parse, so the findings are lost"
          : "the review posted no findings and reached no verdict — it never got far enough to judge the diff",
    };
  }

  return result;
}

async function auditReviewPostFailed(
  row: AssemblyRunRecord,
  prNumber: number,
  message: string,
  ports: ReviewPorts,
): Promise<void> {
  console.error("[code-review] post review failed:", message);
  await writeAuditLog(
    {
      event_type: "review_post_failed",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        error: message,
      },
    },
    ports.audit,
  );
}

interface PostedReviewContext {
  row: AssemblyRunRecord;
  prNumber: number;
  output: string | undefined;
}

/** Audits and classifies a posted-or-skipped review; the `no_findings`/`deduped`/`fallback` shapes each get their own audit row. */
async function classifyPostedReview(
  { row, prNumber, output }: PostedReviewContext,
  posted: Awaited<ReturnType<typeof maybePostReview>>,
  ports: ReviewPorts,
): Promise<ReviewPostOutcome> {
  if (!posted) {
    await auditUnparsedFindings(row, prNumber, output, ports);

    return "no_findings";
  }

  if (posted.mode === "deduped") {
    await auditDedupedPost(row, prNumber, posted.marker, ports);

    return "already_posted";
  }

  if (posted.mode === "fallback") {
    await auditFallbackPost(row, prNumber, posted.error, ports);
  }

  return "posted";
}

export async function postReviewFromNode(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  output?: string,
  ports: ReviewPorts = {},
): Promise<ReviewPostOutcome> {
  const prNumber = prNumberFromRow(row);

  if (!reviewPromptApplies(node, prNumber)) {
    return "not_review";
  }

  try {
    const pulls = await resolvePoster(row, ports.poster);
    const marker = reviewMarkerFor(row, node.id, ports.iteration);
    const diff = await pulls.getDiff(prNumber).catch(() => "");
    const posted = await maybePostReview(pulls, prNumber, output ?? "", {
      positions: commentablePositions(diff),
      marker,
      model: ports.model,
    });

    return await classifyPostedReview({ row, prNumber, output }, posted, ports);
  } catch (err) {
    await auditReviewPostFailed(row, prNumber, (err as Error).message, ports);

    return "post_failed";
  }
}

// The redelivery that #870 exists for: this run's marker is already on the PR, so the post was skipped — audited so a dedupe firing is visible next to the duplicate it prevented.
async function auditDedupedPost(
  row: AssemblyRunRecord,
  prNumber: number,
  marker: string,
  ports: ReviewPorts,
): Promise<void> {
  await writeAuditLog(
    {
      event_type: "review_post_deduped",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        marker,
      },
    },
    ports.audit,
  );
}

// The review reached the PR as a top-level comment after GitHub rejected the inline post (never-drop fallback) — a silent downgrade is invisible at the PR, so it gets an audit row like its siblings.
async function auditFallbackPost(
  row: AssemblyRunRecord,
  prNumber: number,
  error: string,
  ports: ReviewPorts,
): Promise<void> {
  await writeAuditLog(
    {
      event_type: "review_post_degraded",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        error,
      },
    },
    ports.audit,
  );
}

// The exact state that produced the outage: a verdict was reached, no findings parsed, and nothing at all was logged.
async function auditUnparsedFindings(
  row: AssemblyRunRecord,
  prNumber: number,
  output: string | undefined,
  ports: ReviewPorts,
): Promise<void> {
  const verdict = parseReviewVerdict(output);

  console.error(
    `[code-review] no REVIEW_FINDINGS parsed for PR #${prNumber} (verdict: ${verdict ?? "none"}) — nothing posted`,
  );
  await writeAuditLog(
    {
      event_type: "review_findings_unparsed",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        verdict,
        output_length: output?.length ?? 0,
      },
    },
    ports.audit,
  );
}
