import {
  countAnomaly,
  recordAgentCosts,
  writeCostDegradedAudit,
  type CostIngestSummary,
} from "./agent-events-cost.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { MAX_AGENT_EVENTS_BODY_BYTES } from "@re-cinq/lore-shared/http/body-limits.js";
// POST /api/agent-events — ai-agent-subsystem (ADR-031 D8) run-output NDJSON; terminal `result` line feeds pipeline.llm_calls (uncorrelated/failed rows surfaced via metric+audit_log, not dropped, #945), and auth is dual (bus-wide LORE_AGENT_INTERNAL_TOKEN or a satellite's per-agent token, FR5 of specs/running-stations-in-any-k8s-cluster) checked inside the handler since a hapi strategy can only hold one expected token.

import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { enforceRegistryOrSharedToken } from "@re-cinq/lore-shared/http/registry-or-shared-token.js";
import type { RegistryOrSharedTokenDeps } from "@re-cinq/lore-shared/http/registry-or-shared-token.js";
import { pipeline } from "../../../outbound/queues.js";
import { loreApiPlans } from "../../../outbound/lore-api-plans.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  deliverPlanningResults,
  planRunRefOf,
  type PlanRunRef,
} from "../../../work/agent/planning-result.js";
import { deliverSpecReviewResult } from "../../../work/agent/spec-review-result.js";
import { deliverPlanValidation } from "../../../work/agent/plan-validation-result.js";
import { deliverArtifact } from "../../../work/agent/artifact-args.js";
import {
  parseAgentSink,
  type AgentFileEvent,
} from "../../../work/agent/agent-events.js";
import { MAX_RUN_TURNS_PER_BATCH } from "../../../work/agent/agent-run-turns.js";
import { rawBody } from "../raw-body.js";
import type {
  AgentRunEventInsert,
  AgentRunTurnInsert,
} from "@re-cinq/lore-shared";

// Above this body size, run-viz + turn transcript are skipped (cost accounting still recorded) to keep a pathological report from OOM-ing the single (replicaCount: 1) Floor replica — the pod's stdout in Cloud Logging is the sole remaining copy of an oversized stream (#1109).
const MAX_VIZ_BODY_BYTES = MAX_AGENT_EVENTS_BODY_BYTES;

export interface AgentEventsRouteDeps {
  // The registry lookup that lets a satellite's own token in; absent means only the bus-wide token opens the door (pre-satellite behavior).
  findByTokenHash?: RegistryOrSharedTokenDeps["findByTokenHash"];
}

/** Everything one parsed body produced, counted — the DROPPED and CAPPED ones included, since a run whose telemetry silently thinned out is what these exist to make visible. */
interface SinkCounts {
  events: number;
  vizRows: number;
  planningRounds: number;
  turnRows: number;
  turnsDropped: number;
  turnsCapped: number;
  oversized: boolean;
}

/** What the handler needs back: the two body fields it echoes, plus the span attributes it stamps. */
interface AgentSinkResult {
  events: number;
  recorded: number;
  attributes: Record<string, number | boolean>;
}

type ParsedAgentSink = ReturnType<typeof parseAgentSink>;

export function agentEventsRoute(deps: AgentEventsRouteDeps = {}): ServerRoute {
  return {
    method: "POST",
    path: "/api/agent-events",
    // `auth: false` because the credential check is dual and lives in the handler; see the module comment.
    options: { auth: false, payload: { parse: false } },
    handler: (request, h) => handleAgentSink(request, h, deps),
  };
}

/** Authorize, ingest the whole body, stamp the counts on the request span, and echo what landed. */
async function handleAgentSink(
  request: Request,
  h: ResponseToolkit,
  deps: AgentEventsRouteDeps,
): Promise<ResponseObject> {
  await enforceAgentSinkAuth(request.headers, deps);

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
}

/** The dual credential check: the bus-wide token, or a satellite's own registry token. Throws a 401 rather than returning one. */
async function enforceAgentSinkAuth(
  headers: Request["headers"],
  deps: AgentEventsRouteDeps,
): Promise<void> {
  await enforceRegistryOrSharedToken(
    headers,
    {
      sharedToken: process.env.LORE_AGENT_INTERNAL_TOKEN,
      sharedTokenEnvName: "LORE_AGENT_INTERNAL_TOKEN",
      findByTokenHash: deps.findByTokenHash,
    },
    "floor",
  );
}

/** One pass over the NDJSON body feeds every sink: cost rows, run-viz events, turns, and declared artifacts. An oversized body still records COST — only the visualization and turn stores are skipped, because losing telemetry is cheaper than losing the bill. */
async function ingestAgentSink(rawNdjson: string): Promise<AgentSinkResult> {
  const oversized = Buffer.byteLength(rawNdjson, "utf8") > MAX_VIZ_BODY_BYTES;
  // Turns ride the SAME single pass as the cost rows and the projection, reusing the oversized gate — no second parse, no second size rule.
  const parsed = parseAgentSink(rawNdjson, {
    projectRunEvents: !oversized,
    collectTurns: !oversized,
  });
  const cost = await recordAgentCosts(parsed.costRows);
  const stored = await recordRunStores(parsed);
  const projected = await recordSinkProjections(parsed);

  await writeCostDegradedAudit(cost);

  return sinkResult(cost, {
    events: parsed.costRows.length,
    ...stored,
    turnsDropped: parsed.turnsDropped,
    turnsCapped: parsed.turnsCapped,
    oversized,
    ...projected,
  });
}

/** Turns before events: the event insert's trigger is what tells a live viewer to fetch the turns, so they must already be readable when it fires. */
async function recordRunStores(
  parsed: ParsedAgentSink,
): Promise<{ turnRows: number; vizRows: number }> {
  const turnRows =
    parsed.turns.length > 0 ? await recordRunTurns(parsed.turns) : 0;
  const vizRows =
    parsed.runEvents.length > 0 ? await recordRunEvents(parsed.runEvents) : 0;

  return { turnRows, vizRows };
}

// Persist the per-tool-call run-viz projection (#876); the live fan-out is Postgres NOTIFY from the insert's own trigger (migration 0070), so a subscriber learns of a row only once `listSince` can replay it. Skip-not-fail: a viz persistence failure must never 500 the cost sink.
async function recordRunEvents(
  rows: readonly AgentRunEventInsert[],
): Promise<number> {
  try {
    const inserted = await pipeline().agentRunEvents.insertBatch(rows);

    return inserted.length;
  } catch (err) {
    countAnomaly("run_events_failed");
    console.warn(`[floor] agent_run_events skipped: ${errorMessage(err)}`);

    return 0;
  }
}

/** Everything downstream of the cost rows and the viz projection: planning results and artifact hand-off, each skip-not-fail. */
async function recordSinkProjections(
  parsed: ParsedAgentSink,
): Promise<{ planningRounds: number }> {
  // Declared artifacts ride the same sink as cost + telemetry, so a planning round's result lands here rather than needing its own channel.
  const planningRounds = await recordPlanningResults(parsed.fileEvents);

  await deliverSpecReviewResults(parsed.fileEvents);
  await deliverPlanValidations(parsed.fileEvents);
  await mergeArtifacts(parsed.fileEvents);

  reportTurnAnomalies(parsed.turnsDropped, parsed.turnsCapped);

  return { planningRounds };
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

// Settle any planning rounds whose artifact arrived in this batch; skip-not-fail like the projections above since a delivery failure must never 500 the sink (which also carries cost/viz rows for unrelated runs).
async function recordPlanningResults(
  fileEvents: readonly AgentFileEvent[],
): Promise<number> {
  if (fileEvents.length === 0) {
    return 0;
  }

  try {
    return await deliverPlanningResults(fileEvents, {
      planRunOfTask: openPlanRunOfTask,
      plans: loreApiPlans(
        process.env.LORE_API_URL ?? "",
        process.env.LORE_INGEST_TOKEN ?? "",
      ),
    });
  } catch (err) {
    console.warn(`[floor] planning results skipped: ${errorMessage(err)}`);

    return 0;
  }
}

// The plan the task's newest open run drafts — a Refine resumes the same line, so the run, not the task, is what is still working on the plan.
async function openPlanRunOfTask(
  taskId: string,
): Promise<PlanRunRef | undefined> {
  const open = (await pipeline().assemblyRuns.listForTask(taskId)).filter(
    (line) => line.status === "running" || line.status === "queued",
  );
  const newest = open.at(0);

  return newest ? planRunRefOf(newest.args) : undefined;
}

// The spec writer's answer to the spec review goes to the plan and the PR; skip-not-fail like the planning results, and per event so one bad answer never holds another run's back.
async function deliverSpecReviewResults(
  fileEvents: readonly AgentFileEvent[],
): Promise<void> {
  for (const fileEvent of fileEvents) {
    try {
      await deliverSpecReviewResult(fileEvent, {
        assemblyRuns: pipeline().assemblyRuns,
        plans: loreApiPlans(
          process.env.LORE_API_URL ?? "",
          process.env.LORE_INGEST_TOKEN ?? "",
        ),
        pullsFor: async (repo) => (await projectFor(repo)).pulls,
      });
    } catch (err) {
      console.warn(`[floor] spec review result skipped: ${errorMessage(err)}`);
    }
  }
}

// The plan validator's findings go to the plan, not the line's args; skip-not-fail like the spec review results, per event so one bad finding set never holds another run's back.
async function deliverPlanValidations(
  fileEvents: readonly AgentFileEvent[],
): Promise<void> {
  for (const fileEvent of fileEvents) {
    try {
      await deliverPlanValidation(fileEvent, {
        assemblyRuns: pipeline().assemblyRuns,
        plans: loreApiPlans(
          process.env.LORE_API_URL ?? "",
          process.env.LORE_INGEST_TOKEN ?? "",
        ),
      });
    } catch (err) {
      console.warn(`[floor] plan validation result skipped: ${errorMessage(err)}`);
    }
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

/** The response body plus the span attributes, from one folded cost summary and the counts around it. */
function sinkResult(
  cost: CostIngestSummary,
  counts: SinkCounts,
): AgentSinkResult {
  return {
    events: counts.events,
    recorded: cost.recorded,
    attributes: sinkAttributes(cost, counts),
  };
}

/** The span attributes for one sink POST. */
function sinkAttributes(
  cost: { recorded: number; uncorrelated: number; failed: number },
  counts: SinkCounts,
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
