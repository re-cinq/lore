import { createServer } from "node:http";
import { query, isDbAvailable } from "./db.js";

const startTime = Date.now();

export function startHealthServer(
  port: number,
  getJobStatus: () => any,
): void {
  const server = createServer(async (req, res) => {
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
