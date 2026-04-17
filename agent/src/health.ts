import { createServer } from "node:http";
import { query, isDbAvailable } from "./db.js";
import { runReviewReactorForPR } from "./jobs/review-reactor.js";

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
    // Internal trigger endpoint for webhook-driven review reactor.
    if (req.method === "POST" && req.url === "/api/trigger/review-reactor") {
      if (!authInternal(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        const body = await readBody(req);
        const { repo, pr_number } = JSON.parse(body || "{}") as { repo?: string; pr_number?: number };
        if (!repo || !pr_number) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "required: repo, pr_number" }));
          return;
        }
        // Fire-and-forget — return 202 immediately so the webhook sender
        // doesn't time out waiting for the LLM to finish.
        runReviewReactorForPR(repo, pr_number).catch((err) =>
          console.error(`[agent] trigger review-reactor failed:`, err),
        );
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted", repo, pr_number }));
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

  server.listen(port);
  console.log(`[agent] Health server on :${port}/healthz`);
}
