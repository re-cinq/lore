import { errorMessage } from "@re-cinq/lore-shared";
/**
 * POST /api/agent-events — the ai-agent-subsystem (ADR-031 D8) POSTs its run
 * output as NDJSON. The terminal `result` line of each run maps to a
 * pipeline.llm_calls row for cost accounting. task_id is the pod's TASK_ID —
 * the backing task, or the assembly-line id for task-less lines; the writer
 * routes it to task_id or assembly_line_id (migration 0032 keeps the tasks FK
 * and adds assembly_line_id). An id matching neither stores an uncorrelated
 * row rather than failing; a genuine insert error is skipped, not failed, so
 * one bad line never drops the batch. Uncorrelated + failed rows are surfaced
 * (metric + audit_log, issue #945) instead of dropped silently.
 *
 * TWO credentials open this door: the bus-wide LORE_AGENT_INTERNAL_TOKEN, and
 * any registered cluster-agent's per-agent token (matched by SHA-256 against
 * `pipeline.cluster_agents`). The second is what gives a SATELLITE live
 * telemetry — it can never hold the bus-wide secret (FR5 of
 * specs/running-stations-in-any-k8s-cluster), and without a credential of its
 * own its runs report only a terminal outcome, with no cost rows and no
 * run-viz. The check runs INSIDE the handler rather than as a hapi strategy,
 * because a strategy holds exactly one expected token; this is the same shape
 * the event-router's POST /api/events already uses for the same reason.
 */

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

/** Low-cardinality anomaly kinds; a union so a typo fails to compile. */
type AnomalyKind =
  | "cost_uncorrelated"
  | "cost_failed"
  | "run_events_failed"
  | "run_turns_failed"
  | "turn_dropped_redaction"
  | "turn_dropped_cap"
  | "turn_deduped";

/** Counts ingest anomalies so a silent problem shows on a dashboard. No-op
 *  until the OTEL SDK is registered (otel-init), so free in tests. */
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

/**
 * Above this body size the run-visualization projection and the turn transcript
 * are skipped — cost accounting (the terminal `result` line) is still recorded.
 * These are the only body-proportional allocations left after the single-pass
 * parse, so bounding them keeps a pathological report from OOM-ing the single
 * (replicaCount: 1) Floor replica at its memory limit. Above the gate the Floor
 * keeps only the cost rows — the pod's stdout in Cloud Logging is the sole
 * remaining copy of an oversized stream (#1109) — and cost/billing is
 * unaffected.
 */
const MAX_VIZ_BODY_BYTES = 8 * 1024 * 1024;

/** How a batch of cost rows landed: persisted count, plus the two anomaly
 *  classes the sink used to swallow silently. `firstIssue` seeds the audit row. */
export interface CostIngestSummary {
  recorded: number;
  uncorrelated: number;
  failed: number;
  firstTaskId?: string;
  firstIssue?: string;
}

/**
 * Persist one cost row per agent run. A row whose id matches neither a task nor
 * a line stores uncorrelated (counted, not dropped); a genuine insert error is
 * skipped — not failed — so one bad line never drops the batch. Both anomalies
 * increment the metric and feed the audit summary (issue #945).
 */
async function recordAgentCosts(
  rows: readonly LlmCallRow[],
  logCall: (r: LlmCallRecord) => Promise<LlmCallResult> = (r) =>
    usage().logLlmCall(r),
): Promise<CostIngestSummary> {
  const s: CostIngestSummary = { recorded: 0, uncorrelated: 0, failed: 0 };

  for (const row of rows) {
    s.firstTaskId ??= row.taskId;

    try {
      const result = await logCall({ ...row, jobName: "agent" });

      s.recorded++;

      if (result?.correlated === false) {
        s.uncorrelated++;
        s.firstIssue ??= `uncorrelated id ${row.taskId}`;
      }
    } catch (err) {
      s.failed++;
      const msg = errorMessage(err);

      s.firstIssue ??= `insert failed for ${row.taskId}: ${msg}`;
      console.warn(`[floor] llm_calls insert failed for ${row.taskId}: ${msg}`);
    }
  }

  countAnomaly("cost_uncorrelated", s.uncorrelated);
  countAnomaly("cost_failed", s.failed);

  return s;
}

/** The audit_log row for a degraded cost batch, or null when everything
 *  correlated cleanly. Pure — the route does the write. Mirrors the
 *  review_post_degraded audit shape (#942). */
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

/**
 * Persist the per-tool-call run-visualization projection and fan it out (#876).
 * Publishing happens strictly AFTER the insert resolves, so a live subscriber can
 * never see an id that `listSince` cannot replay on reconnect — that ordering is
 * the whole correctness argument for the SSE catch-up. Skip-not-fail like
 * `recordAgentCosts`: a viz persistence failure must never 500 the cost sink.
 */
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

/**
 * Settle any planning rounds whose artifact arrived in this batch. Skip-not-fail
 * like the projections above: a delivery failure must never 500 the sink, which
 * also carries cost and viz rows for unrelated runs.
 */
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
      // The round number the LINE is on. A resumed round mints no task, so the task's
      // own value is stuck at the feature's first round (FR6.22).
      roundOf: async (taskId) => {
        const open = (await pipeline().assemblyRuns.listForTask(taskId)).filter(
          (line) => line.status === "running" || line.status === "queued",
        );
        // Newest first: `listForTask` orders created_at DESC, so the run this
        // round belongs to is at index 0. Taking the last element read the
        // OLDEST open run's iteration whenever a task had more than one.
        const round = open[0]?.args?.iteration;

        return typeof round === "number" ? round : undefined;
      },
    });
  } catch (err) {
    console.warn(`[floor] planning results skipped: ${errorMessage(err)}`);

    return 0;
  }
}

/**
 * Persist the full-fidelity turn transcript (specs/turn-level-transcript-store).
 * Skip-not-fail like `recordRunEvents`, and for a stronger reason: the store is
 * non-authoritative until piloted, so it must never be able to fail the cost
 * sink that is this endpoint's actual contract.
 */
async function recordRunTurns(
  rows: readonly AgentRunTurnInsert[],
): Promise<number> {
  try {
    const inserted = (await pipeline().agentRunTurns.insertBatch(rows)).length;
    const deduped = rows.length - inserted;

    if (deduped > 0) {
      // Expected on a relay retry (#1389), but still counted: every path on
      // which a sent turn does not become a row is visible, and this is the
      // only one that could ever swallow a legitimate line.
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

/**
 * Every OTHER declared artifact becomes the next node's input, merged into its
 * line's args. Best-effort like the planning delivery above: a run that produced its
 * file has already succeeded, and losing the handoff must not retroactively fail it —
 * the consuming node reports the missing input itself.
 */
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

export interface AgentEventsRouteDeps {
  /** The registry lookup that lets a satellite's own token in. Absent means
   *  per-agent tokens are not accepted and only the bus-wide one opens the
   *  door — the behaviour before satellites existed. */
  findByTokenHash?: RegistryOrSharedTokenDeps["findByTokenHash"];
}

export function agentEventsRoute(deps: AgentEventsRouteDeps = {}): ServerRoute {
  return {
    method: "POST",
    path: "/api/agent-events",
    // `auth: false` because the credential check is dual and lives in the
    // handler; see the module comment.
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

      // A throw here becomes a 500 via hapi, and the request-tracing extension
      // records the exception on the request span — no per-handler try/catch.
      const rawNdjson = rawBody(request);
      const oversized =
        Buffer.byteLength(rawNdjson, "utf8") > MAX_VIZ_BODY_BYTES;
      // Turns ride the SAME single pass as the cost rows and the projection, and
      // reuse the same oversized gate — no second parse, no second size rule.
      // Collection is unconditional: there is no flag, so the oversized gate is
      // the only thing that can switch it off.
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
      // Declared artifacts ride the same sink as cost + telemetry, so a planning
      // round's result lands here rather than needing its own channel.
      const planningRounds = await recordPlanningResults(fileEvents);

      await mergeArtifacts(fileEvents);

      if (turnsDropped > 0) {
        // Visible, not silent: redaction that breaks a line's JSON is the store's
        // only lossy path, and an agent can provoke it to keep a line out of its
        // own transcript.
        countAnomaly("turn_dropped_redaction", turnsDropped);
        console.warn(
          `[floor] ${turnsDropped} turn(s) dropped: redaction left the line unparseable`,
        );
      }

      if (turnsCapped > 0) {
        // The other lossy path. Counted for the same reason: a transcript store
        // that quietly truncates is worse than one that says it truncated.
        countAnomaly("turn_dropped_cap", turnsCapped);
        console.warn(
          `[floor] ${turnsCapped} turn(s) dropped: batch cap of ${MAX_RUN_TURNS_PER_BATCH} reached`,
        );
      }

      const audit = costDegradedAudit(cost);

      if (audit) {
        // A failed audit write must not 500 the endpoint — a degraded batch still
        // succeeds (FR5.6); losing the audit row is strictly better than dropping
        // the whole ingest.
        await writeAuditLog(audit).catch((err) =>
          console.warn(
            `[floor] cost-degraded audit write skipped: ${errorMessage(err)}`,
          ),
        );
      }

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
