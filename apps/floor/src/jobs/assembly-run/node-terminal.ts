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
import { usage } from "../../kernel/queues.js";
import { publishPrCheck } from "./pr-check.js";
import { projectFor } from "../../kernel/project-boot.js";
import { writeAuditLog } from "../lib/audit.js";
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

/** The model(s) that actually billed against this visit, read back from `llm_calls`: the dispatch spec snapshots the yaml default while the agent-definition row overrides it at run time, so the disclosure must name the reviewer that really judged the diff. Falls back to the node's declared model when nothing billed. */
async function resolveVisitModel(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
  modelsUsed?: (stationRunId: string) => Promise<string[]>,
): Promise<string | undefined> {
  try {
    const visits = await deps.assemblyRuns.listStationRuns(input.row.id);
    const visit = visits.find(
      (v) =>
        v.nodeId === input.nodeId &&
        (input.iteration === undefined || v.iteration === input.iteration),
    );
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
  await pulls.createReview(prNumber, {
    event: "APPROVE",
    body: withReviewMarker(budgetSkipBody(ports.model), marker),
    comments: [],
  });
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

  return "posted";
}

/** Post the review, record the outcome + advance, then publish the PR check. */
export async function finishNodeTerminal(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
): Promise<void> {
  const model = await resolveVisitModel(input, deps);

  // Out of budget: approve-with-notice (retry budget cannot help, only account topup).
  if (
    input.result.outcome === "failed" &&
    input.result.failureClass === "anthropic-credit" &&
    (await postBudgetSkipReview(input.row, input.node, {
      iteration: input.iteration,
      model,
    })) !== "not_applicable"
  ) {
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

    return;
  }

  const post = await postReviewFromNode(input.row, input.node, input.output, {
    iteration: input.iteration,
    model,
  });

  await postReplyFromNode(input.row, input.node, input.output, {
    iteration: input.iteration,
  });

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
