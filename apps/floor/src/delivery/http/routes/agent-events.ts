import { errorMessage } from "@re-cinq/lore-shared";
// POST /api/agent-events — ai-agent-subsystem (ADR-031 D8) run-output NDJSON; terminal `result` line feeds pipeline.llm_calls (uncorrelated/failed rows surfaced via metric+audit_log, not dropped, #945), and auth is dual (bus-wide LORE_AGENT_INTERNAL_TOKEN or a satellite's per-agent token, FR5 of specs/running-stations-in-any-k8s-cluster) checked inside the handler since a hapi strategy can only hold one expected token.

import type { ServerRoute } from "@hapi/hapi";
import { enforceRegistryOrSharedToken } from "@re-cinq/lore-shared/http/registry-or-shared-token.js";
import type { RegistryOrSharedTokenDeps } from "@re-cinq/lore-shared/http/registry-or-shared-token.js";
import { metrics } from "@opentelemetry/api";
import { pipeline, usage, taskStore } from "../../../kernel/queues.js";
import { projectFor } from "../../../composition/project-boot.js";
import { deliverPlanningResults } from "../../../jobs/agent/planning-result.js";
import { deliverArtifact } from "../../../jobs/agent/artifact-args.js";
import {
  parseAgentSink,
  type LlmCallRow,
  type AgentFileEvent,
} from "../../../jobs/agent/agent-events.js";
import { agentEventBus } from "../../../jobs/agent/agent-event-bus.js";
import { MAX_RUN_TURNS_PER_BATCH } from "../../../jobs/agent/agent-run-turns.js";
import { writeAuditLog } from "../../../jobs/lib/audit.js";
import { rawBody } from "../raw-body.js";
import type {
  AgentRunEventInsert,
  AgentRunTurnInsert,
} from "@re-cinq/lore-shared";
import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import type {
  LlmCallRecord,
  LlmCallResult,
} from "@re-cinq/lore-shared/project/usage/usage-port.js";

// Low-cardinality anomaly kinds; a union so a typo fails to compile.
type AnomalyKind =
  | "cost_uncorrelated"
  | "cost_failed"
  | "run_events_failed"
  | "run_turns_failed"
  | "turn_dropped_redaction"
  | "turn_dropped_cap"
  | "turn_deduped";

// Counts ingest anomalies so a silent problem shows on a dashboard; no-op until the OTEL SDK is registered (otel-init), so free in tests.
const anomalyCounter = metrics
  .getMeter("lore-floor")
  .createCounter("lore.agent_events.anomalies", {
    description:
      "Agent-events ingest anomalies: uncorrelated/failed cost rows, viz/turn failures",
  });

function countAnomaly(kind: AnomalyKind, n = 1): void {
  if (n > 0) {
    anomalyCounter.add(n, { kind });
  }
}

// Above this body size, run-viz + turn transcript are skipped (cost accounting still recorded) to keep a pathological report from OOM-ing the single (replicaCount: 1) Floor replica — the pod's stdout in Cloud Logging is the sole remaining copy of an oversized stream (#1109).
const MAX_VIZ_BODY_BYTES = 8 * 1024 * 1024;

// How a batch of cost rows landed: persisted count, plus the two anomaly classes the sink used to swallow silently. `firstIssue` seeds the audit row.
export interface CostIngestSummary {
  recorded: number;
  uncorrelated: number;
  failed: number;
  firstTaskId?: string;
  firstIssue?: string;
}

type SettledCostRow =
  | { row: LlmCallRow; result: LlmCallResult }
  | { row: LlmCallRow; err: unknown };

function applySuccessfulCostRow(
  summary: CostIngestSummary,
  entry: { row: LlmCallRow; result: LlmCallResult },
): void {
  summary.recorded++;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- UsagePort.logLlmCall's contract says it always resolves a result, but a test double (and any future adapter) can resolve undefined.
  if (entry.result?.correlated === false) {
    summary.uncorrelated++;
    summary.firstIssue ??= `uncorrelated id ${entry.row.taskId}`;
  }
}

function applyFailedCostRow(
  summary: CostIngestSummary,
  entry: { row: LlmCallRow; err: unknown },
): void {
  summary.failed++;
  const msg = errorMessage(entry.err);

  summary.firstIssue ??= `insert failed for ${entry.row.taskId}: ${msg}`;
  console.warn(
    `[floor] llm_calls insert failed for ${entry.row.taskId}: ${msg}`,
  );
}

// Folds one settled insert into the running summary; the failed/uncorrelated split this hides is why recordAgentCosts stays a plain loop over it.
function applySettledCostRow(
  summary: CostIngestSummary,
  entry: SettledCostRow,
): void {
  summary.firstTaskId ??= entry.row.taskId;

  if (!("err" in entry)) {
    applySuccessfulCostRow(summary, entry);

    return;
  }

  applyFailedCostRow(summary, entry);
}

// Persist one cost row per agent run: an unmatched id stores uncorrelated (counted, not dropped), and a genuine insert error is skipped rather than failing the batch — both feed the metric + audit summary (#945).
async function recordAgentCosts(
  rows: readonly LlmCallRow[],
  logCall: (r: LlmCallRecord) => Promise<LlmCallResult> = (r) =>
    usage().logLlmCall(r),
): Promise<CostIngestSummary> {
  const s: CostIngestSummary = { recorded: 0, uncorrelated: 0, failed: 0 };

  // Inserts run in parallel (relay holds the request open across a serial chain otherwise), but the fold below stays sequential over Promise.all's index-ordered results so firstTaskId/firstIssue name the first row, not whichever settled first.
  const settled = await Promise.all(
    rows.map(async (row): Promise<SettledCostRow> => {
      try {
        return { row, result: await logCall({ ...row, jobName: "agent" }) };
      } catch (err) {
        return { row, err };
      }
    }),
  );

  for (const entry of settled) {
    applySettledCostRow(s, entry);
  }

  countAnomaly("cost_uncorrelated", s.uncorrelated);
  countAnomaly("cost_failed", s.failed);

  return s;
}

// The audit_log row for a degraded cost batch, or null when everything correlated cleanly; pure (the route does the write), mirrors the review_post_degraded audit shape (#942).
export function costDegradedAudit(s: CostIngestSummary): AuditLogEntry | null {
  if (s.uncorrelated === 0 && s.failed === 0) {
    return null;
  }

  return {
    event_type: "agent_events_cost_degraded",
    task_id: s.firstTaskId ?? null,
    payload: {
      recorded: s.recorded,
      uncorrelated: s.uncorrelated,
      failed: s.failed,
      first_issue: s.firstIssue ?? null,
    },
  };
}

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
        const round = open[0]?.args?.iteration;

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
async function writeCostDegradedAudit(cost: CostIngestSummary): Promise<void> {
  const audit = costDegradedAudit(cost);

  if (!audit) {
    return;
  }

  await writeAuditLog(audit).catch((err) =>
    console.warn(
      `[floor] cost-degraded audit write skipped: ${errorMessage(err)}`,
    ),
  );
}

export interface AgentEventsRouteDeps {
  // The registry lookup that lets a satellite's own token in; absent means only the bus-wide token opens the door (pre-satellite behavior).
  findByTokenHash?: RegistryOrSharedTokenDeps["findByTokenHash"];
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
      const rawNdjson = rawBody(request);
      const oversized =
        Buffer.byteLength(rawNdjson, "utf8") > MAX_VIZ_BODY_BYTES;
      // Turns ride the SAME single pass as the cost rows and the projection, reusing the oversized gate — no second parse, no second size rule.
      const {
        costRows,
        runEvents,
        fileEvents,
        turns,
        turnsDropped,
        turnsCapped,
      } = parseAgentSink(rawNdjson, !oversized, !oversized);
      const cost = await recordAgentCosts(costRows);
      const vizRows = oversized ? 0 : await recordRunEvents(runEvents);
      const turnRows = turns.length > 0 ? await recordRunTurns(turns) : 0;
      // Declared artifacts ride the same sink as cost + telemetry, so a planning round's result lands here rather than needing its own channel.
      const planningRounds = await recordPlanningResults(fileEvents);

      await mergeArtifacts(fileEvents);

      reportTurnAnomalies(turnsDropped, turnsCapped);
      await writeCostDegradedAudit(cost);

      request.app.span?.setAttributes({
        "agent_events.count": costRows.length,
        "agent_events.recorded": cost.recorded,
        "agent_events.uncorrelated": cost.uncorrelated,
        "agent_events.failed": cost.failed,
        "agent_events.viz_rows": vizRows,
        "agent_events.planning_rounds": planningRounds,
        "agent_events.turn_rows": turnRows,
        "agent_events.turns_dropped": turnsDropped,
        "agent_events.turns_capped": turnsCapped,
        "agent_events.oversized": oversized,
      });

      return h
        .response({
          status: "ok",
          events: costRows.length,
          recorded: cost.recorded,
        })
        .code(200);
    },
  };
}
