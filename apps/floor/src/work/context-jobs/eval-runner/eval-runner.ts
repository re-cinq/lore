import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { evalRuns, taskStore } from "../../../outbound/queues.js";
import { isPromptfooAvailable, runPromptfooEval } from "../lib/promptfoo.js";
import type { PromptfooStats } from "../lib/promptfoo.js";

const EVALS_DIR = process.env.EVALS_DIR || "evals";
const REGRESSION_THRESHOLD = 0.05; // 5% drop triggers alert

interface EvalResult {
  team: string;
  passRate: number;
  total: number;
  passed: number;
  failed: number;
}

/** Nightly Eval Runner (3am UTC, after reindex): runs each team's PromptFoo config, stores results, and files a task when pass rate drops >5%. */
export async function evalRunnerJob(): Promise<string> {
  if (!(await isPromptfooAvailable())) {
    console.log("[job] eval-runner: promptfoo not available, skipping");

    return "Skipped: promptfoo not installed";
  }

  const teamDirs = await listTeamDirs();

  if (teamDirs === null) {
    return "Skipped: no evals directory";
  }

  const results = await evaluateTeams(teamDirs);
  const regressions = await countRegressions(results);
  const summary = `Evaluated ${results.length} teams, ${regressions} regressions detected`;

  console.log(`[job] eval-runner: ${summary}`);

  return summary;
}

/** The team eval configs, or null when the evals directory is absent (already logged). */
async function listTeamDirs(): Promise<string[] | null> {
  try {
    return await readdir(EVALS_DIR);
  } catch {
    console.log(`[job] eval-runner: evals directory "${EVALS_DIR}" not found`);

    return null;
  }
}

/** Sequential by design: promptfoo runs are heavy, and a parallel fan-out would race the same provider quota. */
async function evaluateTeams(teamDirs: string[]): Promise<EvalResult[]> {
  const evaluated: Array<EvalResult | null> = [];

  for (const team of teamDirs) {
    evaluated.push(await runTeamEval(team));
  }

  return evaluated.filter((r): r is EvalResult => r !== null);
}

/** Runs one team's PromptFoo config; logs and returns null for a crashed run or one with no usable stats. */
async function runTeamEval(team: string): Promise<EvalResult | null> {
  const configPath = join(EVALS_DIR, team, "promptfooconfig.yaml");
  const evalResult = await runPromptfooEval({ configPath });

  if (!evalResult.ok) {
    reportUnusableEval(team, evalResult);

    return null;
  }
  const result = toEvalResult(team, evalResult.stats);

  console.log(
    `[job] eval-runner: ${team} — ${result.passed}/${result.total} passed (${(result.passRate * 100).toFixed(1)}%)`,
  );

  return result;
}

/** Says why an eval produced no score. A crash and a missing config are both "no result", but only the first is a problem — logging them the same way trained people to ignore the line. */
function reportUnusableEval(
  team: string,
  result: Extract<Awaited<ReturnType<typeof runPromptfooEval>>, { ok: false }>,
): void {
  if (result.reason === "exec-failed") {
    console.error(
      `[job] eval-runner: eval failed for team ${team}:`,
      result.error,
    );

    return;
  }
  console.error(
    `[job] eval-runner: no usable stats for team ${team} (${result.reason})`,
  );
}

function toEvalResult(team: string, stats: PromptfooStats): EvalResult {
  const total = stats.total ?? 0;
  const passed = stats.passes ?? 0;

  return {
    team,
    passRate: stats.passRate,
    total,
    passed,
    failed: total - passed,
  };
}

async function countRegressions(results: EvalResult[]): Promise<number> {
  const flags: boolean[] = [];

  for (const result of results) {
    flags.push(await recordAndCheckRegression(result));
  }

  return flags.filter(Boolean).length;
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

  await fileRegression(result, prev[0].pass_rate, delta);

  return true;
}

/** Logs the drop and files the gap-fill task that puts it in front of someone. */
async function fileRegression(
  result: EvalResult,
  prevRate: number,
  delta: number,
): Promise<void> {
  console.log(
    `[job] eval-runner: REGRESSION in ${result.team}: ${(prevRate * 100).toFixed(1)}% → ${(result.passRate * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}%)`,
  );

  await taskStore().create({
    description: `Eval regression: ${result.team} dropped from ${(prevRate * 100).toFixed(1)}% to ${(result.passRate * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}% regression)`,
    taskType: "gap-fill",
    targetRepo: result.team,
    createdBy: "eval-runner",
  });
}
