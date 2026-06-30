import { createServer } from "node:http";
import { trace } from "@opentelemetry/api";
import { isDbAvailable } from "../kernel/db.js";
import { usage } from "../kernel/queues.js";
import { parseAgentEvents, agentEventsArchiveKey } from "../jobs/agent/agent-events.js";
import { archiveAgentEvents } from "../jobs/agent/agent-events-store.js";
import { handleGitHubWebhook } from "../listeners/github-webhook.js";
import { handleCiIngestWebhook } from "../listeners/ci-ingest.js";
import { handleCiTestsWebhook } from "../listeners/ci-tests.js";

const startTime = Date.now();
const tracer = trace.getTracer("lore.agent_events");

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
  });
}

function authInternal(req: import("node:http").IncomingMessage): boolean {
  const expected = process.env.LORE_AGENT_INTERNAL_TOKEN;
  if (!expected) return false;
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  return bearer === expected;
}

export function startHealthServer(
  port: number,
  getJobStatus: () => any,
): void {
  const server = createServer(async (req, res) => {
    // ── Layer 1: GitHub webhook ingress (moved into Floor). HMAC-verified inside
    // the handler; it maps the payload to events and INSERTs them — the loop does
    // the work. (Was POST /api/webhook/github on mcp-server + the /api/trigger/* set.)
    if (req.method === "POST" && req.url === "/api/webhook/github") {
      await handleGitHubWebhook(req, res);
      return;
    }

    // ── Layer 1: CI doc-projection ingress (moved into Floor from mcp-server's
    // /ingest-graph). Bearer-authed on LORE_INGEST_TOKEN; maps the body to
    // internal.ingest.spec_trace events and INSERTs them — the loop does the work.
    if (req.method === "POST" && req.url === "/api/webhook/ci-ingest") {
      await handleCiIngestWebhook(req, res);
      return;
    }

    // ── Layer 1: CI test-report ingress. The lore-code-trace binary runs a repo's
    // suite and POSTs the report here; bearer-authed on LORE_INGEST_TOKEN, mapped to
    // an internal.ingest.spec_trace (kind test-report) event for the loop.
    if (req.method === "POST" && req.url === "/api/webhook/ci-tests") {
      await handleCiTestsWebhook(req, res);
      return;
    }

    // Agent telemetry sink (ADR-031 D8): the ai-agent-subsystem POSTs its run output as
    // NDJSON here. We map the terminal `result` line of each run to a pipeline.llm_calls
    // row for cost accounting. A row whose task_id isn't in pipeline.tasks (FK) is
    // skipped, not failed, so one bad line never drops the batch.
    if (req.method === "POST" && req.url === "/api/agent-events") {
      if (!authInternal(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      await tracer.startActiveSpan("ingest", async (span) => {
        try {
          const body = await readBody(req);
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
              console.warn(`[agent] llm_calls insert skipped for ${row.taskId}: ${err.message}`);
            }
          }
          span.setAttribute("events", rows.length);
          span.setAttribute("recorded", recorded);
          // Archive the raw NDJSON for replay (redacted, dormant until a bucket is set).
          // Fire-and-forget: a failed archive must never fail cost-row ingestion.
          void archiveAgentEvents(
            body,
            agentEventsArchiveKey(new Date().toISOString(), rows.map((r) => r.taskId)),
          ).catch((err: any) => console.warn(`[agent] events archive skipped: ${err.message}`));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", events: rows.length, recorded }));
        } catch (err: any) {
          span.recordException(err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        } finally {
          span.end();
        }
      });
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      const connected = await isDbAvailable();

      if (!connected) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "error",
            reason: "database connection failed",
          }),
        );
        return;
      }

      try {
        const { today: processedToday, total: processedTotal } =
          await usage().processedCounts();
        const jobStatus = getJobStatus();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            uptime_seconds: uptimeSeconds,
            tasks: {
              processed_today: processedToday,
              processed_total: processedTotal,
              current: null,
            },
            jobs: jobStatus,
            database: {
              connected: true,
            },
          }),
        );
      } catch (err) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "error",
            reason: "database connection failed",
          }),
        );
      }
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[agent] Health server port ${port} already in use — another agent instance is running. Exiting.`,
      );
    } else {
      console.error("[agent] Health server error:", err);
    }
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`[agent] Health server on :${port}/healthz`);
  });
}
