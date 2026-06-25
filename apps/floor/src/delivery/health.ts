import { createServer } from "node:http";
import { createDgraphClient, ingestSpecTrace } from "@re-cinq/lore-shared";
import { query, isDbAvailable } from "../data/db.js";
import { writeAuditLog } from "../adapters/audit.js";
import { specTraceAuditEntry, specTraceLogLine } from "../adapters/spec-trace-audit.js";
import { runReviewReactorForPR } from "../application/jobs/scheduled/review-reactor.js";
import { validateSpecCoverageJob } from "../application/jobs/scheduled/spec-coverage-validate.js";
import { tryAutoMergeForCompletedTask } from "../application/jobs/auto-merge-trigger.js";
import { parseAgentEvents } from "../adapters/agent-events.js";

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

    // Internal trigger endpoint for post-ingest spec-coverage validate
    // (v3 of spec-test-coverage). mcp-server forwards a fire-and-forget
    // POST here after a successful /api/ingest. The job parses each
    // spec's inline test links and resolves them against the AST chunks;
    // if any rot is found, it opens a `spec-link-rot` labelled issue on
    // the repo. No DB writes. Replaces the v2 `/api/trigger/spec-test-linker`.
    if (req.method === "POST" && req.url === "/api/trigger/spec-coverage-validate") {
      if (!authInternal(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        const body = await readBody(req);
        const { repo } = JSON.parse(body || "{}") as { repo?: string };
        if (!repo || !repo.includes("/")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "required: repo (owner/name)" }));
          return;
        }
        // Fire-and-forget — return 202 immediately so the webhook
        // sender doesn't wait on segmentation + per-link resolution.
        validateSpecCoverageJob({ repoFilter: repo }).catch((err) =>
          console.error(`[agent] trigger spec-coverage-validate failed for ${repo}:`, err),
        );
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted", repo }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Internal trigger endpoint for spec-traceability projection.
    // mcp-server forwards a fire-and-forget POST here after a successful
    // /test-report or /coverage ingest; the dispatcher projects the
    // payload into Dgraph by `kind`. Returns 202 "skipped" when
    // LORE_DGRAPH_HTTP is unset so the projection stays opt-in until the
    // Dgraph cluster is provisioned.
    if (req.method === "POST" && req.url === "/api/trigger/spec-trace") {
      if (!authInternal(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        const body = await readBody(req);
        const { repo, kind, payload } = JSON.parse(body || "{}") as {
          repo?: string;
          kind?: string;
          payload?: unknown;
        };
        if (!repo || !kind) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "required: repo, kind" }));
          return;
        }
        const dgraph = createDgraphClient();
        if (!dgraph) {
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "skipped", reason: "LORE_DGRAPH_HTTP not configured" }));
          return;
        }
        // Fire-and-forget — return 202 immediately so the trigger sender
        // doesn't block on the graph projection. On completion, surface the
        // real graph effect (log line + audit row) instead of discarding it.
        ingestSpecTrace(dgraph, repo, kind, payload)
          .then(async (outcome) => {
            console.log(specTraceLogLine(repo, outcome));
            await writeAuditLog(specTraceAuditEntry(repo, outcome)).catch((err) =>
              console.error(`[agent] spec-trace audit write failed for ${repo}:`, err),
            );
          })
          .catch((err) => console.error(`[agent] trigger spec-trace failed for ${repo} (${kind}):`, err));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted", repo, kind }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Internal trigger endpoint for webhook-driven auto-merge re-fire.
    // mcp-server forwards GitHub `check_run.completed` /
    // `check_suite.completed` (and review-state changes) here so that
    // dark-mode PRs can re-evaluate auto-merge once CI completes —
    // the initial fire from loretask-watcher races CI and almost
    // always defers with `deferred:ci_failed`.
    if (req.method === "POST" && req.url === "/api/trigger/auto-merge") {
      if (!authInternal(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        const body = await readBody(req);
        const { repo, pr_number } = JSON.parse(body || "{}") as {
          repo?: string;
          pr_number?: number;
        };
        if (!repo || !pr_number) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "required: repo, pr_number" }));
          return;
        }
        // Resolve the task id for this PR. Cluster-path PRs from
        // dark-mode repos always have a backing pipeline task; for
        // any other PR the lookup returns no rows and we no-op.
        const rows = await query<{ id: string }>(
          `SELECT id FROM pipeline.tasks
            WHERE target_repo = $1 AND pr_number = $2
            ORDER BY created_at DESC LIMIT 1`,
          [repo, pr_number],
        );
        const taskId = rows[0]?.id;
        if (!taskId) {
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ status: "skipped", reason: "no task for PR" }),
          );
          return;
        }
        // Fire-and-forget — return 202 immediately so the webhook
        // sender doesn't time out waiting for the GitHub API roundtrip.
        // tryAutoMergeForCompletedTask short-circuits when dark mode
        // is off, so this is safe to call for any (repo, PR).
        tryAutoMergeForCompletedTask({ taskId }).catch((err) =>
          console.error(
            `[agent] trigger auto-merge failed for task ${taskId}:`,
            err,
          ),
        );
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted", task_id: taskId }));
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
