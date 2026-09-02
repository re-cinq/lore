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

/**
 * Nightly Eval Runner
 *
 * Runs at 3am UTC (after reindex at 2am). For each team's PromptFoo config:
 * 1. Execute `promptfoo eval`
 * 2. Parse JSON output for pass rate
 * 3. Store results in pipeline.eval_runs
 * 4. If pass rate drops >5% from previous run, create pipeline task
 */
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

  const results: EvalResult[] = [];

  for (const team of teamDirs) {
    const configPath = join(EVALS_DIR, team, "promptfooconfig.yaml");

    const evalResult = await runPromptfooEval({ configPath });

    if (!evalResult.ok) {
      if (evalResult.reason === "exec-failed") {
        console.error(
          `[job] eval-runner: eval failed for team ${team}:`,
          evalResult.error,
        );

        continue;
      }
      console.error(
        `[job] eval-runner: no usable stats for team ${team} (${evalResult.reason})`,
      );

      continue;
    }

    {
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

      results.push(result);
      console.log(
        `[job] eval-runner: ${team} — ${result.passed}/${result.total} passed (${(result.passRate * 100).toFixed(1)}%)`,
      );
    }
  }

  // Store results and check for regressions
  let regressions = 0;

  for (const result of results) {
    // Store result
    await evalRuns().record({
      team: result.team,
      pass_rate: result.passRate,
      total_tests: result.total,
      passed: result.passed,
      failed: result.failed,
    });

    // Check for regression vs previous run
    const prev = await evalRuns().recent(result.team, 1, 1);

    if (prev.length > 0) {
      const delta = result.passRate - prev[0].pass_rate;

      if (delta < -REGRESSION_THRESHOLD) {
        regressions++;
        console.log(
          `[job] eval-runner: REGRESSION in ${result.team}: ${(prev[0].pass_rate * 100).toFixed(1)}% → ${(result.passRate * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}%)`,
        );

        await taskStore().create({
          description: `Eval regression: ${result.team} dropped from ${(prev[0].pass_rate * 100).toFixed(1)}% to ${(result.passRate * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}% regression)`,
          taskType: "gap-fill",
          targetRepo: result.team,
          createdBy: "eval-runner",
        });
      }
    }
  }

  const summary = `Evaluated ${results.length} teams, ${regressions} regressions detected`;

  console.log(`[job] eval-runner: ${summary}`);

  return summary;
}
