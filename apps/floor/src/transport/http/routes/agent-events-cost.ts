// Cost accounting for the agent-events sink: what one run's usage rows cost, and the audit trail when some of them could not be attributed. Separate from agent-events.ts, which owns turning a POSTed body into rows.

import { errorMessage } from "@re-cinq/lore-shared";
import { usage } from "../../../outbound/queues.js";
import { writeAuditLog } from "../../../outbound/audit.js";
import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { metrics } from "@opentelemetry/api";
import type { LlmCallRow } from "../../../work/agent/agent-events.js";
import type {
  LlmCallRecord,
  LlmCallResult,
} from "@re-cinq/lore-shared/project/usage/usage-port.js";

export type AnomalyKind =
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

export function countAnomaly(kind: AnomalyKind, n = 1): void {
  if (n > 0) {
    anomalyCounter.add(n, { kind });
  }
}

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

export async function recordAgentCosts(
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

export async function writeCostDegradedAudit(
  cost: CostIngestSummary,
): Promise<void> {
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
