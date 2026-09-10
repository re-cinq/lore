/** The event registry (layer 2 → layer 3): maps a fully-qualified event_name to exactly one handler; a producer emitting an unregistered name dead-letters with "no handler". */

import {
  codeReviewOnTrigger,
  codeReviewOnComment,
  codeReviewOnReviewSubmitted,
  codeReviewOnClose,
} from "../../work/review/code-review-handlers.js";
import type { EventHandler } from "../../domain/event-types.js";
import * as github from "../handlers/github.js";
import * as internal from "../handlers/internal.js";
import * as cron from "../handlers/cron.js";
import * as detect from "../../work/detect/fan-out.js";
import { implementationLoopTick } from "../../work/backlog/implementation-loop.js";
import * as kubernetes from "../handlers/kubernetes.js";
import { assemblyLineStart } from "../../work/assembly-run/start-event-handler.js";
import { assemblyLineResume } from "../../work/assembly-run/resume-event-handler.js";
import {
  RUN_START_EVENT,
  RUN_RESUME_EVENT,
} from "@re-cinq/lore-shared/project/assembly-runs/run-events.js";
import { agentNodeTerminal } from "../../work/assembly-run/node-event-handler.js";
import { dropOverlayOnClose } from "../../work/assembly-run/drop-overlay.js";
import {
  podLogAppended,
  telemetryPrune,
} from "../../work/station/pod-log-handler.js";
import {} from "../../work/review/code-review.js";

/** Compose one primary handler with best-effort secondaries under one event name; the primary's throw propagates (retry/dead-letter unchanged), a secondary's is logged and swallowed. */
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

type Entry = [string, EventHandler];

export function buildRegistry(): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    ...githubEntries(),
    ...internalEntries(),
    ...kubernetesEntries(),
    ...cronEntries(),
  ]);
}

export function resolve(
  registry: Map<string, EventHandler>,
  eventName: string,
): EventHandler | undefined {
  return registry.get(eventName);
}

/** Layer 1's webhook ingress. `withExtra` rides a second handler alongside the first so neither can break the other — a spec-task sync must not be lost because a parked line failed to wake, or vice versa. */
function githubEntries(): Entry[] {
  return [
    ...prReviewTriggerEntries(),
    [
      "github.pull_request.closed",
      withExtra(
        github.specPrMerge,
        github.specPrResumeLine,
        codeReviewOnClose,
        dropOverlayOnClose,
      ),
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
  ];
}

/** The PR-lifecycle events that all start (or restart) the code-review line. */
function prReviewTriggerEntries(): Entry[] {
  return [
    ["github.pull_request.opened", codeReviewOnTrigger],
    ["github.pull_request.synchronize", codeReviewOnTrigger],
    ["github.pull_request.reopened", codeReviewOnTrigger],
    ["github.pull_request.ready_for_review", codeReviewOnTrigger],
  ];
}

/** mcp-server's post-ingest triggers, plus the assembly-run family. The run events go through their CONSTANTS, so the entries track whatever the writers emit; the pre-rename `assembly_line.*` spellings were deleted in #1272 — a frozen wire value is written literal (FR6.44), the constant beside it is what moves. */
function internalEntries(): Entry[] {
  return [
    ["internal.ingest.spec_trace", internal.specTrace],
    ["internal.repo.team_changed", internal.repoTeamChanged],
    // FR5 (specs/ingest-station): post-ingest validate rides the SAME detect tick as the weekly cron; params.repo narrows it, core runs in a station pod.
    ["internal.ingest.spec_coverage_validate", detect.specCoverageValidateTick],
    [RUN_START_EVENT, assemblyLineStart],
    // A HUMAN station's worker reporting in (planning wizard or spec-PR webhook): same two steps as a terminal CR.
    [RUN_RESUME_EVENT, assemblyLineResume],
  ];
}

/** What the Agent-CR watch reports. Pod stdout is persisted here because the live read and the Cloud Logging fallback are both central-only — a satellite's run has no other log path. */
function kubernetesEntries(): Entry[] {
  return [
    ["kubernetes.agent.succeeded", kubernetes.agentSucceeded],
    ["kubernetes.agent.failed", kubernetes.agentFailed],
    // Assembly-line node CRs (labeled): the event-driven walk's transitions.
    ["kubernetes.agent_node.succeeded", agentNodeTerminal],
    ["kubernetes.agent_node.failed", agentNodeTerminal],
    ["kubernetes.pod_log.appended", podLogAppended],
  ];
}

/** The in-process scheduler's ticks. The last four fan out: one tick starts one per-repo assembly line each, rather than doing the detection work in the handler. */
function cronEntries(): Entry[] {
  return [
    ["cron.merge_check.tick", cron.mergeCheck],
    ["cron.implementation_loop.tick", implementationLoopTick],
    ["cron.pr_ready_check.tick", cron.prReadyCheck],
    ["cron.approval_check.tick", cron.approvalCheck],
    ["cron.spec_task_executor.tick", cron.specTaskExecutor],
    ["cron.stale_task_check.tick", cron.staleTaskCheck],
    ["cron.telemetry_prune.tick", telemetryPrune],
    ["cron.feature_planning_reaper.tick", cron.featurePlanningReaper],
    ["cron.assembly_line_reaper.tick", cron.assemblyLineReaper],
    ["cron.llm_credit_probe.tick", cron.llmCreditProbe],
    ["cron.agent_watcher_reconcile.tick", cron.agentWatcherReconcile],
    ["cron.lease_reaper.tick", cron.leaseReaper],
    ["cron.events_prune.tick", cron.eventsPrune],
    ...detectTickEntries(),
  ];
}

/** The fan-out ticks: one tick starts one per-repo assembly line each. */
function detectTickEntries(): Entry[] {
  return [
    ["cron.gap_detection.tick", detect.gapDetectionTick],
    ["cron.spec_drift.tick", detect.specDriftTick],
    ["cron.spec_coverage_backfill.tick", cron.specCoverageBackfill],
    ["cron.spec_coverage_validate.tick", detect.specCoverageValidateTick],
  ];
}
