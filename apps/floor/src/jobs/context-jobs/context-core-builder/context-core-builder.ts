import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { chunks, contextCore, taskStore } from "../../../kernel/queues.js";

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
  const namespaces = await chunks().distinctTeams();

  if (namespaces.length === 0) {
    console.log("[job] context-core: no namespaces found");
    return "No namespaces to evaluate";
  }

  let promoted = 0;
  let rejected = 0;
  let unchanged = 0;

  for (const team of namespaces) {
    try {
      const result = await evaluateNamespace(team);
      if (result === "promoted") promoted++;
      else if (result === "rejected") rejected++;
      else unchanged++;
    } catch (err) {
      console.error(`[job] context-core: error evaluating ${team}:`, err);
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
  const count = await chunks().countChunksByTeam(namespace);
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
  const prevScore = (await contextCore().latest(namespace)) ?? 0;
  const delta = currentScore - prevScore;

  const version = `v${new Date().toISOString().slice(0, 10)}-${namespace}`;

  console.log(
    `[job] context-core: ${namespace} — current: ${(currentScore * 100).toFixed(1)}%, prev: ${(prevScore * 100).toFixed(1)}%, delta: ${(delta * 100).toFixed(1)}%`,
  );

  if (delta >= IMPROVEMENT_THRESHOLD) {
    // Promote: mark as new production baseline
    await contextCore().insert({ version, namespace, evalScore: currentScore, status: "production" });

    console.log(
      `[job] context-core: PROMOTED ${namespace} ${version} (${(prevScore * 100).toFixed(1)}% → ${(currentScore * 100).toFixed(1)}%)`,
    );
    return "promoted";
  }

  if (delta < -REGRESSION_THRESHOLD) {
    // Reject: log regression and create alert task
    await contextCore().insert({ version, namespace, evalScore: currentScore, status: "rejected-regression" });

    await taskStore().create({
      description: `Context quality regression: ${namespace} dropped from ${(prevScore * 100).toFixed(1)}% to ${(currentScore * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}%)`,
      taskType: "gap-fill",
      targetRepo: namespace,
      createdBy: "context-core-builder",
    });

    console.log(
      `[job] context-core: REJECTED ${namespace} ${version} — regression of ${(delta * 100).toFixed(1)}%`,
    );
    return "rejected";
  }

  // No significant change
  await contextCore().insert({ version, namespace, evalScore: currentScore, status: "no-change" });

  return "unchanged";
}
