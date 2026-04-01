import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { query } from "../db.js";

const execFileAsync = promisify(execFile);

const IMPROVEMENT_THRESHOLD = 0.02; // 2% to promote
const REGRESSION_THRESHOLD = 0.05; // 5% to reject

/**
 * Context Core Builder
 *
 * Runs nightly at 4am UTC (after eval runner at 3am). For each namespace:
 * 1. Export promoted chunks from PostgreSQL
 * 2. Run PromptFoo eval against current context
 * 3. Compare to previous production score
 * 4. Promote if improvement >= 2%, reject if regression > 5%
 */
export async function contextCoreBuilderJob(): Promise<string> {
  // Get all namespaces (teams) that have chunks
  const namespaces = await query<{ team: string }>(
    `SELECT DISTINCT team FROM org_shared.chunks WHERE team IS NOT NULL`,
  );

  if (namespaces.length === 0) {
    console.log("[job] context-core: no namespaces found");
    return "No namespaces to evaluate";
  }

  let promoted = 0;
  let rejected = 0;
  let unchanged = 0;

  for (const ns of namespaces) {
    try {
      const result = await evaluateNamespace(ns.team);
      if (result === "promoted") promoted++;
      else if (result === "rejected") rejected++;
      else unchanged++;
    } catch (err) {
      console.error(`[job] context-core: error evaluating ${ns.team}:`, err);
    }
  }

  const summary = `Evaluated ${namespaces.length} namespaces: ${promoted} promoted, ${rejected} rejected, ${unchanged} unchanged`;
  console.log(`[job] context-core: ${summary}`);
  return summary;
}

async function evaluateNamespace(
  namespace: string,
): Promise<"promoted" | "rejected" | "unchanged"> {
  // Count promoted chunks
  const chunkCount = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM org_shared.chunks WHERE team = $1`,
    [namespace],
  );

  const count = parseInt(chunkCount[0]?.count || "0", 10);
  if (count === 0) {
    console.log(`[job] context-core: ${namespace} has 0 chunks, skipping`);
    return "unchanged";
  }

  // Run PromptFoo eval for this namespace
  const configPath = join("evals", namespace, "promptfooconfig.yaml");
  let currentScore: number;

  try {
    const { stdout } = await execFileAsync(
      "npx",
      ["promptfoo", "eval", "--config", configPath, "--output", "json", "--no-progress-bar"],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
    );

    const output = JSON.parse(stdout) as {
      stats?: { passRate: number };
      results?: { stats?: { passRate: number } };
    };

    currentScore = output.stats?.passRate || output.results?.stats?.passRate || 0;
  } catch {
    console.log(`[job] context-core: no eval config for ${namespace}, skipping`);
    return "unchanged";
  }

  // Get previous production score
  const prevRows = await query<{ eval_score: number }>(
    `SELECT eval_score FROM pipeline.context_core_history
     WHERE namespace = $1 AND status = 'production'
     ORDER BY promoted_at DESC
     LIMIT 1`,
    [namespace],
  );

  const prevScore = prevRows[0]?.eval_score ?? 0;
  const delta = currentScore - prevScore;

  const version = `v${new Date().toISOString().slice(0, 10)}-${namespace}`;

  console.log(
    `[job] context-core: ${namespace} — current: ${(currentScore * 100).toFixed(1)}%, prev: ${(prevScore * 100).toFixed(1)}%, delta: ${(delta * 100).toFixed(1)}%`,
  );

  if (delta >= IMPROVEMENT_THRESHOLD) {
    // Promote: mark as new production baseline
    await query(
      `INSERT INTO pipeline.context_core_history (version, namespace, eval_score, status)
       VALUES ($1, $2, $3, 'production')`,
      [version, namespace, currentScore],
    );

    console.log(
      `[job] context-core: PROMOTED ${namespace} ${version} (${(prevScore * 100).toFixed(1)}% → ${(currentScore * 100).toFixed(1)}%)`,
    );
    return "promoted";
  }

  if (delta < -REGRESSION_THRESHOLD) {
    // Reject: log regression and create alert task
    await query(
      `INSERT INTO pipeline.context_core_history (version, namespace, eval_score, status)
       VALUES ($1, $2, $3, 'rejected-regression')`,
      [version, namespace, currentScore],
    );

    await query(
      `INSERT INTO pipeline.tasks (description, task_type, status, target_repo)
       VALUES ($1, 'gap-fill', 'pending', $2)
       ON CONFLICT DO NOTHING`,
      [
        `Context quality regression: ${namespace} dropped from ${(prevScore * 100).toFixed(1)}% to ${(currentScore * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}%)`,
        namespace,
      ],
    );

    console.log(
      `[job] context-core: REJECTED ${namespace} ${version} — regression of ${(delta * 100).toFixed(1)}%`,
    );
    return "rejected";
  }

  // No significant change
  await query(
    `INSERT INTO pipeline.context_core_history (version, namespace, eval_score, status)
     VALUES ($1, $2, $3, 'no-change')`,
    [version, namespace, currentScore],
  );

  return "unchanged";
}
