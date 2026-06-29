import { createServer } from "node:http";
import { query, isDbAvailable } from "../kernel/db.js";
import { parseAgentEvents } from "../agent/agent-events.js";
import { handleGitHubWebhook } from "../listeners/github-webhook.js";

const startTime = Date.now();

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
      try {
        const rows = parseAgentEvents(await readBody(req));
        let recorded = 0;
        for (const row of rows) {
          try {
            await query(
              `INSERT INTO pipeline.llm_calls
                 (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
               VALUES ($1, 'agent', $2, $3, $4, $5, $6)`,
              [row.taskId, row.model, row.inputTokens, row.outputTokens, row.costUsd, row.durationMs],
            );
            recorded++;
          } catch (err: any) {
            console.warn(`[agent] llm_calls insert skipped for ${row.taskId}: ${err.message}`);
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", events: rows.length, recorded }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
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
        const todayRows = await query<{ today: number }>(
          "SELECT count(*)::int as today FROM pipeline.llm_calls WHERE created_at > current_date",
        );
        const totalRows = await query<{ total: number }>(
          "SELECT count(*)::int as total FROM pipeline.llm_calls",
        );

        const processedToday = todayRows[0]?.today ?? 0;
        const processedTotal = totalRows[0]?.total ?? 0;
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
