// Post first, then transition, then publish the check: finishNodeAndAdvance can finish the line and both callers early-return on a non-running row, so anything posted after can't be repaired by a retry — shared by the node-event handler and the reaper so the dropped-event path stops silently losing reviews.

import {
  agentStderrError,
  resultTextFromOutput,
  terminalErrorText,
  type AgentNodeStatus,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { finishNodeAndAdvance } from "./finish-node.js";
import type { AdvanceDeps } from "./advance-deps.js";
import { budgetSkipBody } from "@re-cinq/lore-shared/review/review-summary.js";
import { usage } from "../../outbound/queues.js";
import { publishPrCheck } from "./pr-check.js";
import { projectFor } from "../../outbound/project-boot.js";
import { writeAuditLog } from "../../outbound/audit.js";
import {
  prNumberFromRow,
  reviewPromptApplies,
  resolvePoster,
  reviewMarkerFor,
  withReviewMarker,
} from "./review-node-helpers.js";
import {
  postReviewFromNode,
  reviewNodeResultOverride,
  type ReviewPorts,
} from "./review-post.js";
import { postReplyFromNode } from "./reply-post.js";
import { reviewAlreadyPosted } from "../review/post-review.js";

export {
  postReviewFromNode,
  reviewNodeResultOverride,
  type ReviewPorts,
  type ReviewPostOutcome,
} from "./review-post.js";
export {
  postReplyFromNode,
  type ReplyPoster,
  type ReplyPorts,
  type ReplyPostOutcome,
} from "./reply-post.js";

// Unwraps the Agent output envelope AND lifts the terminal error text before the raw stream is gone — reading after unwrap always returned null, which is why FR6.14's billing alert never fired (billing errors misread as Job-level BackoffLimitExceeded, #1455).
export function normalizeAgentStatus(status: AgentNodeStatus): AgentNodeStatus {
  if (status.output === undefined) {
    return status;
  }
  // Falls back through stderr because a boot crash has no result line — without it, the walk misread a permanent misconfig as retryable infra and burned a 25min retry (run 129235d4, 2026-08-28).
  const errorText =
    terminalErrorText(status.output) ??
    agentStderrError(status.output) ??
    status.errorText;
  const unwrapped = { ...status, output: resultTextFromOutput(status.output) };

  return errorText === undefined ? unwrapped : { ...unwrapped, errorText };
}

export interface NodeTerminalInput {
  row: AssemblyRunRecord;
  node: RunGraphNode;
  nodeId: string;
  iteration?: number;
  result: NodeResult;
  /** The node's agent text, already normalized by {@link normalizeAgentStatus}. */
  output?: string;
}

/** Post the review, record the outcome + advance, then publish the PR check. */
export async function finishNodeTerminal(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
): Promise<void> {
  const model = await resolveVisitModel(input, deps);

  if (await handledAsBudgetSkip(input, model, deps)) {
    return;
  }
  const post = await postNodeArtifacts(input, model);

  await finishNodeAndAdvance(
    {
      assemblyLineId: input.row.id,
      nodeId: input.nodeId,
      iteration: input.iteration,
      result: reviewNodeResultOverride(post, input.output, input.result),
    },
    deps,
  );

  await publishCheck(input.row.id, deps);
}

/** The model(s) that actually billed against this visit, read back from `llm_calls`: the dispatch spec snapshots the yaml default while the agent-definition row overrides it at run time, so the disclosure must name the reviewer that really judged the diff. Falls back to the node's declared model when nothing billed. */
async function resolveVisitModel(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
  modelsUsed?: (stationRunId: string) => Promise<string[]>,
): Promise<string | undefined> {
  try {
    const visits = await deps.assemblyRuns.listStationRuns(input.row.id);
    const visit = visits.find((candidate) => isVisitFor(candidate, input));
    const models = visit?.stationRunId
      ? await (modelsUsed ?? ((id) => usage().modelsUsed(id)))(
          visit.stationRunId,
        )
      : [];

    return models.length > 0 ? models.join(", ") : input.node.model;
  } catch {
    return input.node.model;
  }
}

/** The station run for this exact visit: the same node, and — when the caller knows which revisit fired — the same iteration. */
function isVisitFor(
  visit: { nodeId: string; iteration: number },
  input: NodeTerminalInput,
): boolean {
  return (
    visit.nodeId === input.nodeId &&
    (input.iteration === undefined || visit.iteration === input.iteration)
  );
}

/** Out of budget: approve-with-notice and finish as SUCCESS. A retry cannot help — only a topup can — so failing the node would spend the run's remaining iterations re-hitting the same wall. Returns false when this is not a credit failure, or the node is not one that reviews. */
async function handledAsBudgetSkip(
  input: NodeTerminalInput,
  model: string | undefined,
  deps: AdvanceDeps,
): Promise<boolean> {
  if (!isCreditFailure(input.result)) {
    return false;
  }
  const posted = await postBudgetSkipReview(input.row, input.node, {
    iteration: input.iteration,
    model,
  });

  if (posted === "not_applicable") {
    return false;
  }

  await finishAsSuccess(input, deps);

  return true;
}

/** An exhausted LLM budget, the one failure a retry cannot clear. */
function isCreditFailure(result: NodeResult): boolean {
  return (
    result.outcome === "failed" && result.failureClass === "anthropic-credit"
  );
}

/** A review visit that failed on an exhausted LLM budget must not block the PR — an empty account is an operator problem, not the author's — so post an APPROVE saying loudly that no review happened (deduped by the same per-visit marker as a real review) and record the visit as success. */
export async function postBudgetSkipReview(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  ports: ReviewPorts = {},
): Promise<"posted" | "already_posted" | "not_applicable"> {
  const prNumber = prNumberFromRow(row);

  if (!reviewPromptApplies(node, prNumber)) {
    return "not_applicable";
  }
  const pulls = await resolvePoster(row, ports.poster);
  const marker = reviewMarkerFor(row, node.id, ports.iteration);

  if (marker && (await reviewAlreadyPosted(pulls, prNumber, marker))) {
    return "already_posted";
  }
  await approveWithNotice(pulls, prNumber, { marker, model: ports.model });
  await auditBudgetSkip(row, prNumber, ports);

  return "posted";
}

/** The APPROVE nobody's model produced: the body says loudly that no review happened, and carries the same per-visit marker a real review would. */
async function approveWithNotice(
  pulls: Awaited<ReturnType<typeof resolvePoster>>,
  prNumber: number,
  notice: { marker: string | undefined; model?: string },
): Promise<void> {
  await pulls.createReview(prNumber, {
    event: "APPROVE",
    body: withReviewMarker(budgetSkipBody(notice.model), notice.marker),
    comments: [],
  });
}

/** The audit row for an approval nobody's model actually produced — without it the PR shows a green review with no run behind it, and the reason (a dry account) is only in the body text. */
async function auditBudgetSkip(
  row: AssemblyRunRecord,
  prNumber: number,
  ports: ReviewPorts,
): Promise<void> {
  await writeAuditLog(
    {
      event_type: "review_budget_skip",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        model: ports.model ?? null,
      },
    },
    ports.audit,
  );
}

/** Records the visit as SUCCESS and publishes the check, so the run moves on instead of spending its remaining iterations re-hitting the same wall. */
async function finishAsSuccess(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
): Promise<void> {
  await finishNodeAndAdvance(
    {
      assemblyLineId: input.row.id,
      nodeId: input.nodeId,
      iteration: input.iteration,
      result: { outcome: "success" },
    },
    deps,
  );
  await publishCheck(input.row.id, deps);
}

/** Posts both PR artifacts a terminal node can carry — the review and the in-thread reply — returning what the review post did, since that alone can override the node outcome. */
async function postNodeArtifacts(
  input: NodeTerminalInput,
  model: string | undefined,
): Promise<Awaited<ReturnType<typeof postReviewFromNode>>> {
  const post = await postReviewFromNode(input.row, input.node, input.output, {
    iteration: input.iteration,
    model,
  });

  await postReplyFromNode(input.row, input.node, input.output, {
    iteration: input.iteration,
  });

  return post;
}

// Publish the line's current state as a PR check (in_progress while running, terminal once finished); best-effort — a missing `checks: write` never blocks.
export async function publishCheck(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const [row, nodes] = await Promise.all([
    deps.assemblyRuns.getById(assemblyLineId),
    deps.assemblyRuns.listStationRuns(assemblyLineId),
  ]);

  if (!row || !(Number(row.args.pr_number) > 0)) {
    return;
  }
  const project = await projectFor(row.repo);

  await publishPrCheck(project.repo, row, nodes, process.env.LORE_UI_URL);
}
