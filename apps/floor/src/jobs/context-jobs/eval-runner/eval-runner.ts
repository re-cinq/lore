import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { evalRuns, taskStore } from "../../../kernel/queues.js";
import { isPromptfooAvailable, runPromptfooEval } from "../lib/promptfoo.js";

const EVALS_DIR = process.env.EVALS_DIR || "evals";
const REGRESSION_THRESHOLD = 0.05; // 5% drop triggers alert

interface EvalResult {
  team: string;
  passRate: number;
  total: number;
  passed: number;
  failed: number;
}

/** Runs one team's PromptFoo config; logs and returns null for a crashed run or one with no usable stats. */
async function runTeamEval(team: string): Promise<EvalResult | null> {
  const configPath = join(EVALS_DIR, team, "promptfooconfig.yaml");
  const evalResult = await runPromptfooEval({ configPath });

  if (!evalResult.ok && evalResult.reason === "exec-failed") {
    console.error(
      `[job] eval-runner: eval failed for team ${team}:`,
      evalResult.error,
    );

    return null;
  }

  if (!evalResult.ok) {
    console.error(
      `[job] eval-runner: no usable stats for team ${team} (${evalResult.reason})`,
    );

    return null;
  }

  const stats = evalResult.stats;
  const total = stats.total ?? 0;
  const passed = stats.passes ?? 0;
  const result: EvalResult = {
    team,
    passRate: stats.passRate,
    total,
    passed,
    failed: total - passed,
  };

  console.log(
    `[job] eval-runner: ${team} — ${result.passed}/${result.total} passed (${(result.passRate * 100).toFixed(1)}%)`,
  );

  return result;
}

/** Stores one team's result and, when it drops pass rate by more than the threshold vs the previous run, logs + files a gap-fill task. Returns whether it was a regression. */
async function recordAndCheckRegression(result: EvalResult): Promise<boolean> {
  await evalRuns().record({
    team: result.team,
    pass_rate: result.passRate,
    total_tests: result.total,
    passed: result.passed,
    failed: result.failed,
  });

  const prev = await evalRuns().recent(result.team, 1, 1);

  if (prev.length === 0) {
    return false;
  }

  const delta = result.passRate - prev[0].pass_rate;

  if (delta >= -REGRESSION_THRESHOLD) {
    return false;
  }

  console.log(
    `[job] eval-runner: REGRESSION in ${result.team}: ${(prev[0].pass_rate * 100).toFixed(1)}% → ${(result.passRate * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}%)`,
  );

  await taskStore().create({
    description: `Eval regression: ${result.team} dropped from ${(prev[0].pass_rate * 100).toFixed(1)}% to ${(result.passRate * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}% regression)`,
    taskType: "gap-fill",
    targetRepo: result.team,
    createdBy: "eval-runner",
  });

  return true;
}

/** Nightly Eval Runner (3am UTC, after reindex): runs each team's PromptFoo config, stores results, and files a task when pass rate drops >5%. */
export async function evalRunnerJob(): Promise<string> {
  if (!(await isPromptfooAvailable())) {
    console.log("[job] eval-runner: promptfoo not available, skipping");

    return "Skipped: promptfoo not installed";
  }

  // Find team eval configs
  let teamDirs: string[];

  try {
    teamDirs = await readdir(EVALS_DIR);
  } catch {
    console.log(`[job] eval-runner: evals directory "${EVALS_DIR}" not found`);

    return "Skipped: no evals directory";
  }

  const evaluated: Array<EvalResult | null> = [];

  for (const team of teamDirs) {
    evaluated.push(await runTeamEval(team));
  }

  const results = evaluated.filter((r): r is EvalResult => r !== null);
  const regressionFlags: boolean[] = [];

  for (const result of results) {
    regressionFlags.push(await recordAndCheckRegression(result));
  }

  const regressions = regressionFlags.filter(Boolean).length;
  const summary = `Evaluated ${results.length} teams, ${regressions} regressions detected`;

  console.log(`[job] eval-runner: ${summary}`);

  return summary;
}
