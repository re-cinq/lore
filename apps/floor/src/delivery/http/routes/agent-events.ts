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
 * (metric + audit_log, issue #945) instead of dropped silently. Bearer-authed
 * on LORE_AGENT_INTERNAL_TOKEN (internal-token strategy).
 */

import type { ServerRoute } from "@hapi/hapi";
import { metrics } from "@opentelemetry/api";
import { usage, agentRunEvents } from "../../../kernel/queues.js";
import {
  parseAgentSink,
  agentEventsArchiveKey,
  type LlmCallRow,
} from "../../../jobs/agent/agent-events.js";
import { agentEventBus } from "../../../jobs/agent/agent-event-bus.js";
import { archiveAgentEvents } from "../../../jobs/agent/agent-events-store.js";
import { writeAuditLog } from "../../../jobs/lib/audit.js";
import { rawBody } from "../raw-body.js";
import type { AgentRunEventInsert } from "@re-cinq/lore-shared";
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
  | "archive_failed"
  | "archive_shed";

/** Counts ingest anomalies so a silent problem shows on a dashboard. No-op
 *  until the OTEL SDK is registered (otel-init), so free in tests. */
const anomalyCounter = metrics
  .getMeter("lore-floor")
  .createCounter("lore.agent_events.anomalies", {
    description:
      "Agent-events ingest anomalies: uncorrelated/failed cost rows, viz/archive failures",
  });

function countAnomaly(kind: AnomalyKind, n = 1): void {
  if (n > 0) {
    anomalyCounter.add(n, { kind });
  }
}

/**
 * Above this body size the run-visualization projection and the full-body GCS
 * archive copy are skipped — cost accounting (the terminal `result` line) is
 * still recorded. These are the only body-proportional allocations left after
 * the single-pass parse, so bounding them keeps a pathological report from
 * OOM-ing the single (replicaCount: 1) Floor replica at its 512Mi limit. The
 * dropped viz is a nice-to-have; full fidelity remains in the raw NDJSON the
 * agent subsystem streams, and cost/billing is unaffected.
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
 * Each in-flight archive pins the raw body plus its redacted copy (≤2× the 8MB
 * viz cap) until GCS resolves, so unbounded fire-and-forget stacked ~16MB per
 * concurrent POST and OOM-crash-looped the 512Mi Floor the first time the
 * bucket env was set (2026-07-24). Beyond this many concurrent uploads the
 * body is shed — counted, cost ingestion untouched, and the run's own raw
 * stream still exists on the agent-subsystem side.
 */
const MAX_ARCHIVES_IN_FLIGHT = 2;
let archivesInFlight = 0;

/**
 * Archive the raw NDJSON for replay (redacted, dormant until a bucket is set).
 * Fire-and-forget behind a small in-flight bound: a failed or shed archive
 * must never fail cost-row ingestion.
 */
function archiveRaw(body: string, rows: readonly LlmCallRow[]): void {
  if (archivesInFlight >= MAX_ARCHIVES_IN_FLIGHT) {
    countAnomaly("archive_shed");
    console.warn(
      `[floor] events archive shed: ${archivesInFlight} uploads already in flight`,
    );

    return;
  }
  const key = agentEventsArchiveKey(
    new Date().toISOString(),
    rows.map((r) => r.taskId),
  );

  // Retention is handled by the task-logs bucket's log_retention_days lifecycle
  // rule (the bucket LORE_AGENT_EVENTS_BUCKET points at); no app-side pruning.
  archivesInFlight++;
  void archiveAgentEvents(body, key)
    .catch((err) => {
      countAnomaly("archive_failed");
      console.warn(`[floor] events archive skipped: ${errorMessage(err)}`);
    })
    .finally(() => {
      archivesInFlight--;
    });
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
    const inserted = await agentRunEvents().insertBatch(rows);

    agentEventBus().publish(inserted);

    return inserted.length;
  } catch (err) {
    countAnomaly("run_events_failed");
    console.warn(`[floor] agent_run_events skipped: ${errorMessage(err)}`);

    return 0;
  }
}

export const agentEventsRoute: ServerRoute = {
  method: "POST",
  path: "/api/agent-events",
  options: { auth: "internal-token", payload: { parse: false } },
  handler: async (request, h) => {
    // A throw here becomes a 500 via hapi, and the request-tracing extension
    // records the exception on the request span — no per-handler try/catch.
    const rawNdjson = rawBody(request);
    const oversized = Buffer.byteLength(rawNdjson, "utf8") > MAX_VIZ_BODY_BYTES;
    const { costRows, runEvents } = parseAgentSink(rawNdjson, !oversized);
    const cost = await recordAgentCosts(costRows);
    const vizRows = oversized ? 0 : await recordRunEvents(runEvents);

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
      "agent_events.oversized": oversized,
    });

    if (!oversized) {
      archiveRaw(rawNdjson, costRows);
    }

    return h
      .response({
        status: "ok",
        events: costRows.length,
        recorded: cost.recorded,
      })
      .code(200);
  },
};
