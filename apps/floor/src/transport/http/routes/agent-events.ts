import {
  countAnomaly,
  recordAgentCosts,
  writeCostDegradedAudit,
} from "./agent-events-cost.js";
import { errorMessage } from "@re-cinq/lore-shared";
// POST /api/agent-events — ai-agent-subsystem (ADR-031 D8) run-output NDJSON; terminal `result` line feeds pipeline.llm_calls (uncorrelated/failed rows surfaced via metric+audit_log, not dropped, #945), and auth is dual (bus-wide LORE_AGENT_INTERNAL_TOKEN or a satellite's per-agent token, FR5 of specs/running-stations-in-any-k8s-cluster) checked inside the handler since a hapi strategy can only hold one expected token.

import type { ServerRoute } from "@hapi/hapi";
import { enforceRegistryOrSharedToken } from "@re-cinq/lore-shared/http/registry-or-shared-token.js";
import type { RegistryOrSharedTokenDeps } from "@re-cinq/lore-shared/http/registry-or-shared-token.js";
import { pipeline, taskStore } from "../../../outbound/queues.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { deliverPlanningResults } from "../../../work/agent/planning-result.js";
import { deliverArtifact } from "../../../work/agent/artifact-args.js";
import {
  parseAgentSink,
  type AgentFileEvent,
} from "../../../work/agent/agent-events.js";
import { agentEventBus } from "../../../work/agent/agent-event-bus.js";
import { MAX_RUN_TURNS_PER_BATCH } from "../../../work/agent/agent-run-turns.js";
import { rawBody } from "../raw-body.js";
import type {
  AgentRunEventInsert,
  AgentRunTurnInsert,
} from "@re-cinq/lore-shared";

// Low-cardinality anomaly kinds; a union so a typo fails to compile.

// Counts ingest anomalies so a silent problem shows on a dashboard; no-op until the OTEL SDK is registered (otel-init), so free in tests.

// Above this body size, run-viz + turn transcript are skipped (cost accounting still recorded) to keep a pathological report from OOM-ing the single (replicaCount: 1) Floor replica — the pod's stdout in Cloud Logging is the sole remaining copy of an oversized stream (#1109).
const MAX_VIZ_BODY_BYTES = 8 * 1024 * 1024;

// How a batch of cost rows landed: persisted count, plus the two anomaly classes the sink used to swallow silently. `firstIssue` seeds the audit row.

// Folds one settled insert into the running summary; the failed/uncorrelated split this hides is why recordAgentCosts stays a plain loop over it.

// Persist one cost row per agent run: an unmatched id stores uncorrelated (counted, not dropped), and a genuine insert error is skipped rather than failing the batch — both feed the metric + audit summary (#945).

// The audit_log row for a degraded cost batch, or null when everything correlated cleanly; pure (the route does the write), mirrors the review_post_degraded audit shape (#942).

// Persist the per-tool-call run-viz projection and fan it out (#876); publish strictly AFTER insert resolves so a live subscriber never sees an id `listSince` can't replay on reconnect — the SSE catch-up's correctness argument. Skip-not-fail: a viz persistence failure must never 500 the cost sink.
async function recordRunEvents(
  rows: readonly AgentRunEventInsert[],
): Promise<number> {
  try {
    const inserted = await pipeline().agentRunEvents.insertBatch(rows);

    agentEventBus().publish(inserted);

    return inserted.length;
  } catch (err) {
    countAnomaly("run_events_failed");
    console.warn(`[floor] agent_run_events skipped: ${errorMessage(err)}`);

    return 0;
  }
}

// Settle any planning rounds whose artifact arrived in this batch; skip-not-fail like the projections above since a delivery failure must never 500 the sink (which also carries cost/viz rows for unrelated runs).
async function recordPlanningResults(
  fileEvents: readonly AgentFileEvent[],
): Promise<number> {
  if (fileEvents.length === 0) {
    return 0;
  }

  try {
    return await deliverPlanningResults(fileEvents, {
      tasks: taskStore(),
      featuresFor: projectFor,
      // The round number the LINE is on — a resumed round mints no task, so the task's own value is stuck at the feature's first round (FR6.22).
      roundOf: async (taskId) => {
        const open = (await pipeline().assemblyRuns.listForTask(taskId)).filter(
          (line) => line.status === "running" || line.status === "queued",
        );
        // Newest first: `listForTask` orders created_at DESC so index 0 is this round's run — the last element would read the OLDEST open run's iteration.
        const newest = open.at(0);
        const round = newest?.args.iteration;

        return typeof round === "number" ? round : undefined;
      },
    });
  } catch (err) {
    console.warn(`[floor] planning results skipped: ${errorMessage(err)}`);

    return 0;
  }
}

// Persist the full-fidelity turn transcript (specs/turn-level-transcript-store); skip-not-fail like recordRunEvents, and more so — the store is non-authoritative until piloted and must never fail the cost sink that is this endpoint's actual contract.
async function recordRunTurns(
  rows: readonly AgentRunTurnInsert[],
): Promise<number> {
  try {
    const inserted = (await pipeline().agentRunTurns.insertBatch(rows)).length;
    const deduped = rows.length - inserted;

    if (deduped > 0) {
      // Expected on a relay retry (#1389), but still counted — this is the only path that could ever swallow a legitimate line.
      countAnomaly("turn_deduped", deduped);
      console.warn(
        `[floor] ${deduped} turn(s) skipped as already-stored duplicates`,
      );
    }

    return inserted;
  } catch (err) {
    countAnomaly("run_turns_failed");
    console.warn(`[floor] agent_run_turns skipped: ${errorMessage(err)}`);

    return 0;
  }
}

// Every OTHER declared artifact becomes the next node's input, merged into its line's args; best-effort — a run that produced its file has already succeeded, so losing the handoff must not retroactively fail it (the consuming node reports the missing input itself).
async function mergeArtifacts(
  fileEvents: readonly AgentFileEvent[],
): Promise<void> {
  for (const fileEvent of fileEvents) {
    try {
      await deliverArtifact(fileEvent, {
        assemblyRuns: pipeline().assemblyRuns,
      });
    } catch (err) {
      console.warn(`[floor] artifact not merged: ${errorMessage(err)}`);
    }
  }
}

// Visible, not silent: redaction that breaks a line's JSON and the batch cap are the store's only lossy paths.
function reportTurnAnomalies(turnsDropped: number, turnsCapped: number): void {
  if (turnsDropped > 0) {
    countAnomaly("turn_dropped_redaction", turnsDropped);
    console.warn(
      `[floor] ${turnsDropped} turn(s) dropped: redaction left the line unparseable`,
    );
  }

  if (turnsCapped > 0) {
    countAnomaly("turn_dropped_cap", turnsCapped);
    console.warn(
      `[floor] ${turnsCapped} turn(s) dropped: batch cap of ${MAX_RUN_TURNS_PER_BATCH} reached`,
    );
  }
}

// A failed audit write must not 500 the endpoint — a degraded batch still succeeds (FR5.6); losing the audit row beats dropping the whole ingest.

export interface AgentEventsRouteDeps {
  // The registry lookup that lets a satellite's own token in; absent means only the bus-wide token opens the door (pre-satellite behavior).
  findByTokenHash?: RegistryOrSharedTokenDeps["findByTokenHash"];
}

/** One pass over the NDJSON body feeds every sink: cost rows, run-viz events, turns, and declared artifacts. An oversized body still records COST — only the visualization and turn stores are skipped, because losing telemetry is cheaper than losing the bill. */
async function ingestAgentSink(rawNdjson: string): Promise<{
  events: number;
  recorded: number;
  attributes: Record<string, number | boolean>;
}> {
  const oversized = Buffer.byteLength(rawNdjson, "utf8") > MAX_VIZ_BODY_BYTES;
  // Turns ride the SAME single pass as the cost rows and the projection, reusing the oversized gate — no second parse, no second size rule.
  const { costRows, runEvents, fileEvents, turns, turnsDropped, turnsCapped } =
    parseAgentSink(rawNdjson, !oversized, !oversized);
  const cost = await recordAgentCosts(costRows);
  const vizRows = oversized ? 0 : await recordRunEvents(runEvents);
  const turnRows = turns.length > 0 ? await recordRunTurns(turns) : 0;
  // Declared artifacts ride the same sink as cost + telemetry, so a planning round's result lands here rather than needing its own channel.
  const planningRounds = await recordPlanningResults(fileEvents);

  await mergeArtifacts(fileEvents);

  reportTurnAnomalies(turnsDropped, turnsCapped);
  await writeCostDegradedAudit(cost);

  return {
    events: costRows.length,
    recorded: cost.recorded,
    attributes: sinkAttributes(cost, {
      events: costRows.length,
      vizRows,
      planningRounds,
      turnRows,
      turnsDropped,
      turnsCapped,
      oversized,
    }),
  };
}

/** The span attributes for one sink POST. Every count is carried, including the DROPPED and CAPPED ones — a run whose telemetry silently thinned out is exactly what these exist to make visible. */
function sinkAttributes(
  cost: { recorded: number; uncorrelated: number; failed: number },
  counts: {
    events: number;
    vizRows: number;
    planningRounds: number;
    turnRows: number;
    turnsDropped: number;
    turnsCapped: number;
    oversized: boolean;
  },
): Record<string, number | boolean> {
  return {
    "agent_events.count": counts.events,
    "agent_events.recorded": cost.recorded,
    "agent_events.uncorrelated": cost.uncorrelated,
    "agent_events.failed": cost.failed,
    "agent_events.viz_rows": counts.vizRows,
    "agent_events.planning_rounds": counts.planningRounds,
    "agent_events.turn_rows": counts.turnRows,
    "agent_events.turns_dropped": counts.turnsDropped,
    "agent_events.turns_capped": counts.turnsCapped,
    "agent_events.oversized": counts.oversized,
  };
}

export function agentEventsRoute(deps: AgentEventsRouteDeps = {}): ServerRoute {
  return {
    method: "POST",
    path: "/api/agent-events",
    // `auth: false` because the credential check is dual and lives in the handler; see the module comment.
    options: { auth: false, payload: { parse: false } },
    handler: async (request, h) => {
      await enforceRegistryOrSharedToken(
        request.headers,
        {
          sharedToken: process.env.LORE_AGENT_INTERNAL_TOKEN,
          sharedTokenEnvName: "LORE_AGENT_INTERNAL_TOKEN",
          findByTokenHash: deps.findByTokenHash,
        },
        "floor",
      );

      // A throw here becomes a 500 via hapi, and the request-tracing extension records the exception on the request span — no per-handler try/catch.
      const ingested = await ingestAgentSink(rawBody(request));

      const { span } = request.app;

      span?.setAttributes(ingested.attributes);

      return h
        .response({
          status: "ok",
          events: ingested.events,
          recorded: ingested.recorded,
        })
        .code(200);
    },
  };
}
