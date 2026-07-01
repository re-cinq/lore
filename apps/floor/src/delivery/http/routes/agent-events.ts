/**
 * POST /api/agent-events — the ai-agent-subsystem (ADR-031 D8) POSTs its run
 * output as NDJSON. The terminal `result` line of each run maps to a
 * pipeline.llm_calls row for cost accounting. A row whose task_id isn't in
 * pipeline.tasks (FK) is skipped, not failed, so one bad line never drops the
 * batch. Bearer-authed on LORE_AGENT_INTERNAL_TOKEN (internal-token strategy).
 */

import type { ServerRoute } from "@hapi/hapi";
import { trace } from "@opentelemetry/api";
import { usage } from "../../../kernel/queues.js";
import { parseAgentEvents, agentEventsArchiveKey } from "../../../jobs/agent/agent-events.js";
import { archiveAgentEvents } from "../../../jobs/agent/agent-events-store.js";
import { rawBody } from "../raw-body.js";

const tracer = trace.getTracer("lore.agent_events");

export const agentEventsRoute: ServerRoute = {
  method: "POST",
  path: "/api/agent-events",
  options: { auth: "internal-token", payload: { parse: false } },
  handler: (request, h) =>
    tracer.startActiveSpan("ingest", async (span) => {
      try {
        const body = rawBody(request);
        const rows = parseAgentEvents(body);
        let recorded = 0;
        for (const row of rows) {
          try {
            await usage().logLlmCall({
              taskId: row.taskId,
              jobName: "agent",
              model: row.model,
              inputTokens: row.inputTokens,
              outputTokens: row.outputTokens,
              costUsd: row.costUsd,
              durationMs: row.durationMs,
            });
            recorded++;
          } catch (err: any) {
            console.warn(`[floor] llm_calls insert skipped for ${row.taskId}: ${err.message}`);
          }
        }
        span.setAttribute("events", rows.length);
        span.setAttribute("recorded", recorded);
        // Archive the raw NDJSON for replay (redacted, dormant until a bucket is set).
        // Fire-and-forget: a failed archive must never fail cost-row ingestion.
        void archiveAgentEvents(
          body,
          agentEventsArchiveKey(new Date().toISOString(), rows.map((r) => r.taskId)),
        ).catch((err: any) => console.warn(`[floor] events archive skipped: ${err.message}`));
        return h.response({ status: "ok", events: rows.length, recorded }).code(200);
      } catch (err: any) {
        span.recordException(err);
        return h.response({ error: err.message }).code(500);
      } finally {
        span.end();
      }
    }),
};
