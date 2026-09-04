import { join } from "node:path";
import { chunks, contextCore, taskStore } from "../../../kernel/queues.js";
import { runPromptfooEval } from "../lib/promptfoo.js";

const IMPROVEMENT_THRESHOLD = 0.02; // 2% to promote; 5% regression threshold to reject
const REGRESSION_THRESHOLD = 0.05;

/** Context Core Builder: nightly eval at 4am UTC; promote chunks if +2%, reject if -5%. */
export async function contextCoreBuilderJob(): Promise<string> {
  // Get all namespaces (teams) that have chunks
  const namespaces = await chunks().distinctTeams();

  if (namespaces.length === 0) {
    console.log("[job] context-core: no namespaces found");

    return "No namespaces to evaluate";
  }

  const tally: Record<"promoted" | "rejected" | "unchanged", number> = {
    promoted: 0,
    rejected: 0,
    unchanged: 0,
  };

  for (const team of namespaces) {
    try {
      const result = await evaluateNamespace(team);

      tally[result]++;
    } catch (err) {
      console.error(`[job] context-core: error evaluating ${team}:`, err);
    }
  }

  const summary = `Evaluated ${namespaces.length} namespaces: ${tally.promoted} promoted, ${tally.rejected} rejected, ${tally.unchanged} unchanged`;

  console.log(`[job] context-core: ${summary}`);

  return summary;
}

/** Runs the namespace's PromptFoo eval; null means "skip" (no config, or eval crashed/timed out) — already logged. */
async function evalScoreOrSkip(namespace: string): Promise<number | null> {
  const configPath = join("evals", namespace, "promptfooconfig.yaml");
  const evalResult = await runPromptfooEval({ configPath });

  // Distinguish absent config from crash/timeout; don't log genuine regressions as "no config".
  if (!evalResult.ok && evalResult.reason === "config-missing") {
    console.log(
      `[job] context-core: no eval config for ${namespace}, skipping`,
    );

    return null;
  }

  if (!evalResult.ok) {
    console.error(
      `[job] context-core: eval did not produce a score for ${namespace} (${evalResult.reason})`,
      evalResult.reason === "exec-failed" ? evalResult.error : "",
    );

    return null;
  }

  return evalResult.stats.passRate;
}

interface EvalDecisionInput {
  namespace: string;
  currentScore: number;
  prevScore: number;
  delta: number;
  version: string;
}

async function applyEvalDecision(
  input: EvalDecisionInput,
): Promise<"promoted" | "rejected" | "unchanged"> {
  const { namespace, currentScore, prevScore, delta, version } = input;

  if (delta >= IMPROVEMENT_THRESHOLD) {
    // Promote: mark as new production baseline
    await contextCore().insert({
      version,
      namespace,
      evalScore: currentScore,
      status: "production",
    });

    console.log(
      `[job] context-core: PROMOTED ${namespace} ${version} (${(prevScore * 100).toFixed(1)}% → ${(currentScore * 100).toFixed(1)}%)`,
    );

    return "promoted";
  }

  if (!(delta < -REGRESSION_THRESHOLD)) {
    // No significant change
    await contextCore().insert({
      version,
      namespace,
      evalScore: currentScore,
      status: "no-change",
    });

    return "unchanged";
  }

  // Reject: log regression and create alert task
  await contextCore().insert({
    version,
    namespace,
    evalScore: currentScore,
    status: "rejected-regression",
  });

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

async function evaluateNamespace(
  namespace: string,
): Promise<"promoted" | "rejected" | "unchanged"> {
  // Count promoted chunks
  const count = await chunks().countChunksByTeam(namespace);

  if (count === 0) {
    console.log(`[job] context-core: ${namespace} has 0 chunks, skipping`);

    return "unchanged";
  }

  const currentScore = await evalScoreOrSkip(namespace);

  if (currentScore === null) {
    return "unchanged";
  }

  // Get previous production score
  const prevScore = (await contextCore().latest(namespace)) ?? 0;
  const delta = currentScore - prevScore;

  const version = `v${new Date().toISOString().slice(0, 10)}-${namespace}`;

  console.log(
    `[job] context-core: ${namespace} — current: ${(currentScore * 100).toFixed(1)}%, prev: ${(prevScore * 100).toFixed(1)}%, delta: ${(delta * 100).toFixed(1)}%`,
  );

  return applyEvalDecision({
    namespace,
    currentScore,
    prevScore,
    delta,
    version,
  });
}
