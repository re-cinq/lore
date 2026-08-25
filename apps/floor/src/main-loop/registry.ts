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
import { assemblyLineStart } from "../jobs/assembly-run/start-event-handler.js";
import { assemblyLineResume } from "../jobs/assembly-run/resume-event-handler.js";
import {
  RUN_START_EVENT,
  RUN_RESUME_EVENT,
} from "@re-cinq/lore-shared/project/assembly-runs/run-events.js";
import { agentNodeTerminal } from "../jobs/assembly-run/node-event-handler.js";
import {
  codeReviewOnTrigger,
  codeReviewOnComment,
  codeReviewOnReviewSubmitted,
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
    ["github.pull_request.opened", codeReviewOnTrigger],
    ["github.pull_request.synchronize", codeReviewOnTrigger],
    ["github.pull_request.reopened", codeReviewOnTrigger],
    ["github.pull_request.ready_for_review", codeReviewOnTrigger],
    [
      "github.pull_request.closed",
      // specPrResumeLine is the one that wakes a line parked on `merged`. It rides
      // as an EXTRA so a throw in it cannot stop the spec-task sync, and vice versa.
      withExtra(github.specPrMerge, github.specPrResumeLine, codeReviewOnClose),
    ],
    [
      "github.pull_request_review.submitted",
      withExtra(github.onReviewSubmitted, codeReviewOnReviewSubmitted),
    ],
    ["github.pull_request_review_comment.created", codeReviewOnComment],
    ["github.check_run.completed", github.autoMerge],
    ["github.check_suite.completed", github.autoMerge],
    ["github.issue_comment.created", codeReviewOnComment],
    ["github.issues.labeled", github.issuesLabeled],

    // ── Internal (mcp-server post-ingest) ──
    ["internal.ingest.spec_trace", internal.specTrace],
    ["internal.repo.team_changed", internal.repoTeamChanged],
    // FR5 (specs/ingest-station): the post-ingest validate rides the SAME detect
    // tick as the weekly cron — params.repo narrows it, the core runs in a
    // station pod, never inline in the Floor.
    ["internal.ingest.spec_coverage_validate", detect.specCoverageValidateTick],

    // ── Assembly lines (project.assemblyRuns.start() inserts row + event atomically;
    //    a top-level family — the assembly line is a primary concept, its producer
    //    spans shared/mcp/floor rather than one source) ──
    // Through the constant: the live entry must track whatever the writers emit,
    // so a future flip cannot leave the Floor deaf to the current spelling.
    [RUN_START_EVENT, assemblyLineStart],
    // A HUMAN station's worker reporting in: the planning wizard, or the spec-PR
    // webhook. Same two steps as a terminal CR — record the node, advance the walk.
    [RUN_RESUME_EVENT, assemblyLineResume],
    // The pre-rename `assembly_line.*` entries were deleted 2026-08-18 (#1272),
    // one retention window after the writer flip — the events table is pruned
    // after handling, so no unhandled row still carries the old spelling. The
    // rule they taught stands (FR6.44): a frozen wire value is spelled as a
    // LITERAL, because the constant beside it is the thing that moves.

    // ── Kubernetes (the Agent-CR watch emits on terminal phase) ──
    ["kubernetes.agent.succeeded", kubernetes.agentSucceeded],
    ["kubernetes.agent.failed", kubernetes.agentFailed],
    // Assembly-line node CRs (labeled): the event-driven walk's transitions.
    ["kubernetes.agent_node.succeeded", agentNodeTerminal],
    ["kubernetes.agent_node.failed", agentNodeTerminal],

    // ── Cron (in-process scheduler emits the tick; loop runs it) ──
    ["cron.merge_check.tick", cron.mergeCheck],
    ["cron.approval_check.tick", cron.approvalCheck],
    ["cron.spec_task_executor.tick", cron.specTaskExecutor],
    ["cron.stale_task_check.tick", cron.staleTaskCheck],
    ["cron.feature_planning_reaper.tick", cron.featurePlanningReaper],
    ["cron.assembly_line_reaper.tick", cron.assemblyLineReaper],
    ["cron.llm_credit_probe.tick", cron.llmCreditProbe],
    ["cron.agent_watcher_reconcile.tick", cron.agentWatcherReconcile],
    ["cron.lease_reaper.tick", cron.leaseReaper],
    ["cron.events_prune.tick", cron.eventsPrune],

    // ── Detection fan-out (tick → one per-repo assembly-line start each) ──
    ["cron.gap_detection.tick", detect.gapDetectionTick],
    ["cron.spec_drift.tick", detect.specDriftTick],
    ["cron.spec_coverage_backfill.tick", cron.specCoverageBackfill],
    ["cron.spec_coverage_validate.tick", detect.specCoverageValidateTick],
  ]);
}

export function resolve(
  registry: Map<string, EventHandler>,
  eventName: string,
): EventHandler | undefined {
  return registry.get(eventName);
}
