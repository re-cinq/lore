/**
 * The event registry (layer 2 → layer 3): maps a fully-qualified event_name to
 * exactly one handler. The loop calls `resolve` for each claimed event. Adding a
 * producer that emits a new name requires a matching entry here, or the event
 * dead-letters with "no handler".
 */

import type { EventHandler } from "./types.js";
import * as github from "../jobs/github.js";
import * as internal from "../jobs/internal.js";
import * as cron from "../jobs/cron.js";
import * as detect from "../jobs/detect/fan-out.js";
import * as kubernetes from "../jobs/kubernetes.js";
import { assemblyLineStart } from "../jobs/assembly-line/start-event-handler.js";
import { agentNodeTerminal } from "../jobs/assembly-line/node-event-handler.js";
import {
  codeReviewOnOpen,
  codeReviewOnReply,
  codeReviewOnClose,
} from "../jobs/review/code-review.js";

/**
 * Compose one primary handler with best-effort secondaries under a single event
 * name (the registry is one-handler-per-event). The primary's throw propagates so
 * its retry/dead-letter semantics are unchanged; a secondary throw is logged and
 * swallowed so an added reaction can never break the existing handler.
 */
export function withExtra(
  primary: EventHandler,
  ...extra: EventHandler[]
): EventHandler {
  return async (params) => {
    await primary(params);

    for (const handler of extra) {
      await handler(params).catch((err) =>
        console.warn(
          "[code-review] secondary handler failed:",
          (err as Error).message,
        ),
      );
    }
  };
}

export function buildRegistry(): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    // ── GitHub (layer 1: floor webhook ingress) ──
    [
      "github.pull_request.opened",
      withExtra(github.reviewReactor, codeReviewOnOpen),
    ],
    ["github.pull_request.synchronize", github.reviewReactor],
    [
      "github.pull_request.reopened",
      withExtra(github.reviewReactor, codeReviewOnOpen),
    ],
    [
      "github.pull_request.ready_for_review",
      withExtra(github.reviewReactor, codeReviewOnOpen),
    ],
    [
      "github.pull_request.closed",
      withExtra(github.specPrMerge, codeReviewOnClose),
    ],
    ["github.pull_request_review.submitted", github.onReviewSubmitted],
    ["github.pull_request_review_comment.created", codeReviewOnReply],
    ["github.check_run.completed", github.autoMerge],
    ["github.check_suite.completed", github.autoMerge],
    [
      "github.issue_comment.created",
      withExtra(github.reviewReactor, codeReviewOnReply),
    ],
    ["github.issues.labeled", github.issuesLabeled],

    // ── Internal (mcp-server post-ingest) ──
    ["internal.ingest.spec_trace", internal.specTrace],
    ["internal.ingest.spec_coverage_validate", internal.specCoverageValidate],

    // ── Assembly lines (project.assemblyLines.start() inserts row + event atomically;
    //    a top-level family — the assembly line is a primary concept, its producer
    //    spans shared/mcp/floor rather than one source) ──
    ["assembly_line.start", assemblyLineStart],

    // ── Kubernetes (the Agent-CR watch emits on terminal phase) ──
    ["kubernetes.agent.succeeded", kubernetes.agentSucceeded],
    ["kubernetes.agent.failed", kubernetes.agentFailed],
    // Assembly-line node CRs (labeled): the event-driven walk's transitions.
    ["kubernetes.agent_node.succeeded", agentNodeTerminal],
    ["kubernetes.agent_node.failed", agentNodeTerminal],

    // ── Cron (in-process scheduler emits the tick; loop runs it) ──
    ["cron.merge_check.tick", cron.mergeCheck],
    ["cron.approval_check.tick", cron.approvalCheck],
    ["cron.review_reactor.tick", cron.reviewReactorCron],
    ["cron.spec_task_executor.tick", cron.specTaskExecutor],
    ["cron.stale_task_check.tick", cron.staleTaskCheck],
    ["cron.feature_planning_reaper.tick", cron.featurePlanningReaper],
    ["cron.assembly_line_reaper.tick", cron.assemblyLineReaper],
    ["cron.agent_watcher_reconcile.tick", cron.agentWatcherReconcile],
    ["cron.lease_reaper.tick", cron.leaseReaper],
    ["cron.events_prune.tick", cron.eventsPrune],

    // ── Detection fan-out (tick → one per-repo assembly-line start each) ──
    ["cron.gap_detection.tick", detect.gapDetectionTick],
    ["cron.spec_drift.tick", detect.specDriftTick],
    ["cron.spec_coverage_backfill.tick", detect.specCoverageBackfillTick],
    ["cron.spec_coverage_validate.tick", detect.specCoverageValidateTick],
  ]);
}

export function resolve(
  registry: Map<string, EventHandler>,
  eventName: string,
): EventHandler | undefined {
  return registry.get(eventName);
}
