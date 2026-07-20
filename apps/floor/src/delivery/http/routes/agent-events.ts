import { errorMessage } from "@re-cinq/lore-shared";
/**
 * POST /api/agent-events — the ai-agent-subsystem (ADR-031 D8) POSTs its run
 * output as NDJSON. The terminal `result` line of each run maps to a
 * pipeline.llm_calls row for cost accounting. A row whose task_id isn't in
 * pipeline.tasks (FK) is skipped, not failed, so one bad line never drops the
 * batch. Bearer-authed on LORE_AGENT_INTERNAL_TOKEN (internal-token strategy).
 */

import type { ServerRoute } from "@hapi/hapi";
import { usage, agentRunEvents } from "../../../kernel/queues.js";
import {
  parseAgentEvents,
  agentEventsArchiveKey,
  type LlmCallRow,
} from "../../../jobs/agent/agent-events.js";
import { parseAgentRunEvents } from "../../../jobs/agent/agent-run-events.js";
import { agentEventBus } from "../../../jobs/agent/agent-event-bus.js";
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
    } catch (err) {
      console.warn(
        `[floor] llm_calls insert skipped for ${row.taskId}: ${errorMessage(err)}`,
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

  // TODO: we must update the infra to drop the logs after 30 days. (this should be a variable.)
  // TODO: we should use here a ProxyPromise that wraps the promise and logs errors. This way we can avoid using try/catch here.
  void archiveAgentEvents(body, key).catch((err) =>
    console.warn(`[floor] events archive skipped: ${errorMessage(err)}`),
  );
}

/**
 * Persist the per-tool-call run-visualization projection and fan it out (#876).
 * Publishing happens strictly AFTER the insert resolves, so a live subscriber can
 * never see an id that `listSince` cannot replay on reconnect — that ordering is
 * the whole correctness argument for the SSE catch-up. Skip-not-fail like
 * `recordAgentCosts`: a viz persistence failure must never 500 the cost sink.
 */
async function recordRunEvents(rawNdjson: string): Promise<number> {
  try {
    const inserted = await agentRunEvents().insertBatch(
      parseAgentRunEvents(rawNdjson),
    );

    agentEventBus().publish(inserted);

    return inserted.length;
  } catch (err) {
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
    const rows = parseAgentEvents(rawNdjson);
    const recorded = await recordAgentCosts(rows);
    const vizRows = await recordRunEvents(rawNdjson);

    request.app.span?.setAttributes({
      "agent_events.count": rows.length,
      "agent_events.recorded": recorded,
      "agent_events.viz_rows": vizRows,
    });
    archiveRaw(rawNdjson, rows);

    return h
      .response({ status: "ok", events: rows.length, recorded })
      .code(200);
  },
};
