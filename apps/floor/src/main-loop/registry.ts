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
import * as kubernetes from "../jobs/kubernetes.js";

export function buildRegistry(): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    // ── GitHub (layer 1: floor webhook ingress) ──
    ["github.pull_request.opened", github.reviewReactor],
    ["github.pull_request.synchronize", github.reviewReactor],
    ["github.pull_request.reopened", github.reviewReactor],
    ["github.pull_request.ready_for_review", github.reviewReactor],
    ["github.pull_request.closed", github.specPrMerge],
    ["github.pull_request_review.submitted", github.onReviewSubmitted],
    ["github.check_run.completed", github.autoMerge],
    ["github.check_suite.completed", github.autoMerge],
    ["github.issue_comment.created", github.reviewReactor],
    ["github.issues.labeled", github.issuesLabeled],

    // ── Internal (mcp-server post-ingest) ──
    ["internal.ingest.spec_trace", internal.specTrace],
    ["internal.ingest.spec_coverage_validate", internal.specCoverageValidate],

    // ── Cron (in-process scheduler emits the tick; loop runs it) ──
    ["cron.merge_check.tick", cron.mergeCheck],
    ["cron.approval_check.tick", cron.approvalCheck],
    ["cron.review_reactor.tick", cron.reviewReactorCron],
    ["cron.spec_task_executor.tick", cron.specTaskExecutor],
    ["cron.stale_task_check.tick", cron.staleTaskCheck],
    ["cron.feature_planning_reaper.tick", cron.featurePlanningReaper],
    ["cron.events_prune.tick", cron.eventsPrune],
  ]);
}

export function resolve(registry: Map<string, EventHandler>, eventName: string): EventHandler | undefined {
  return registry.get(eventName);
}
