/** The event registry (layer 2 → layer 3): maps a fully-qualified event_name to exactly one handler; a producer emitting an unregistered name dead-letters with "no handler". */

import { takenByStations } from "./floor-stand-down.js";
import type { EventHandler } from "../../domain/event-types.js";
import * as github from "../handlers/github.js";
import * as internal from "../handlers/internal.js";
import * as cron from "../handlers/cron.js";
import { dailyDigestTick } from "../../work/digest/fan-out.js";
import { implementationLoopTick } from "../../work/backlog/implementation-loop.js";
import * as kubernetes from "../handlers/kubernetes.js";
import { assemblyLineStart } from "../../work/assembly-run/start-event-handler.js";
import { assemblyLineResume } from "../../work/assembly-run/resume-event-handler.js";
import { assemblyRunStation } from "../../work/assembly-run/run-station-event-handler.js";
import {
  RUN_START_EVENT,
  RUN_RESUME_EVENT,
  RUN_STATION_EVENT,
} from "@re-cinq/lore-shared/project/assembly-runs/run-events.js";
import { agentNodeTerminal } from "../../work/assembly-run/node-event-handler.js";
import { podLogAppended } from "../../work/station/pod-log-handler.js";

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
          "[registry] secondary handler failed:",
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
    prClosedEntry(),
    ["github.pull_request_review.submitted", github.onReviewSubmitted],
    ["github.check_run.completed", github.autoMerge],
    ["github.check_suite.completed", github.autoMerge],
  ];
}

/** What a closed PR finishes here: the spec-task sync and the parked line's wake. Its head branch's graph overlay is dropped by the stations service, which also cancels the review lines a close ends on the external floor. */
function prClosedEntry(): Entry {
  return [
    "github.pull_request.closed",
    withExtra(github.specPrMerge, github.specPrResumeLine),
  ];
}

/** mcp-server's post-ingest triggers, plus the assembly-run family. The run events go through their CONSTANTS, so the entries track whatever the writers emit; the pre-rename `assembly_line.*` spellings were deleted in #1272 — a frozen wire value is written literal (FR6.44), the constant beside it is what moves. */
function internalEntries(): Entry[] {
  return [
    ["internal.ingest.spec_trace", internal.specTrace],
    ["internal.repo.team_changed", internal.repoTeamChanged],
    [RUN_START_EVENT, assemblyLineStart],
    // A HUMAN station's worker reporting in (planning wizard or spec-PR webhook): same two steps as a terminal CR.
    [RUN_RESUME_EVENT, assemblyLineResume],
    // A person ran one station by hand: its next iteration, in the same run.
    [RUN_STATION_EVENT, assemblyRunStation],
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

/** The ticks this process still answers; the stations service emits them. */
function cronEntries(): Entry[] {
  return [
    ["cron.merge_check.tick", takenByStations],
    ["cron.implementation_loop.tick", implementationLoopTick],
    ["cron.pr_ready_check.tick", takenByStations],
    ["cron.approval_check.tick", takenByStations],
    ["cron.spec_task_executor.tick", takenByStations],
    ["cron.stale_task_check.tick", cron.staleTaskCheck],
    ["cron.telemetry_prune.tick", takenByStations],
    ["cron.assembly_line_reaper.tick", cron.assemblyLineReaper],
    ["cron.llm_credit_probe.tick", cron.llmCreditProbe],
    ["cron.agent_watcher_reconcile.tick", cron.agentWatcherReconcile],
    ["cron.lease_reaper.tick", cron.leaseReaper],
    ["cron.events_prune.tick", takenByStations],
    ...detectTickEntries(),
  ];
}

/** The ticks that start a run per repository or per channel. */
function detectTickEntries(): Entry[] {
  return [
    ["cron.spec_upkeep.tick", takenByStations],
    ["cron.daily_digest.tick", dailyDigestTick],
  ];
}
