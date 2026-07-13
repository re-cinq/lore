/**
 * POST /api/agent-events — the ai-agent-subsystem (ADR-031 D8) POSTs its run
 * output as NDJSON. The terminal `result` line of each run maps to a
 * pipeline.llm_calls row for cost accounting. A row whose task_id isn't in
 * pipeline.tasks (FK) is skipped, not failed, so one bad line never drops the
 * batch. Bearer-authed on LORE_AGENT_INTERNAL_TOKEN (internal-token strategy).
 */

import type { ServerRoute } from "@hapi/hapi";
import { usage } from "../../../kernel/queues.js";
import {
  parseAgentEvents,
  agentEventsArchiveKey,
  type LlmCallRow,
} from "../../../jobs/agent/agent-events.js";
import { archiveAgentEvents } from "../../../jobs/agent/agent-events-store.js";
import { rawBody } from "../raw-body.js";

/**
 * Persist one cost row per agent run. A row whose task_id isn't in pipeline.tasks
 * (FK) is skipped — not failed — so one bad line never drops the batch. Returns
 * how many rows were persisted.
 */
/// This function must be part of one of the ports from the shared package. It is not a good idea to have this function here in the floor app. It should be part of the usage port.
async function recordAgentCosts(rows: readonly LlmCallRow[]): Promise<number> {
  let recorded = 0;

  for (const row of rows) {
    try {
      await usage().logLlmCall({ ...row, jobName: "agent" });
      recorded++;
    } catch (err: any) {
      console.warn(
        `[floor] llm_calls insert skipped for ${row.taskId}: ${err.message}`,
      );
    }
  }
  return recorded;
}

/**
 * Archive the raw NDJSON for replay (redacted, dormant until a bucket is set).
 * Fire-and-forget: a failed archive must never fail cost-row ingestion.
 */
function archiveRaw(body: string, rows: readonly LlmCallRow[]): void {
  const key = agentEventsArchiveKey(
    new Date().toISOString(),
    rows.map((r) => r.taskId),
  );

  // todo: we must update the infra to drop the logs after 30 days. (this should be a variable.)
  void archiveAgentEvents(body, key).catch((err: any) =>
    console.warn(`[floor] events archive skipped: ${err.message}`),
  );
}

export const agentEventsRoute: ServerRoute = {
  method: "POST",
  path: "/api/agent-events",
  options: { auth: "internal-token", payload: { parse: false } },
  handler: async (request, h) => {
    // A throw here becomes a 500 via hapi, and the request-tracing extension
    // records the exception on the request span — no per-handler try/catch.
    const rawNdjson = rawBody(request);
    const rows = parseAgentEvents(rawNdjson);
    const recorded = await recordAgentCosts(rows);

    request.app.span?.setAttributes({
      "agent_events.count": rows.length,
      "agent_events.recorded": recorded,
    });
    archiveRaw(rawNdjson, rows);

    return h
      .response({ status: "ok", events: rows.length, recorded })
      .code(200);
  },
};
