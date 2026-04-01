import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { query } from "../db.js";

const execFileAsync = promisify(execFile);

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
  // Check if promptfoo is available
  try {
    await execFileAsync("npx", ["promptfoo", "--version"], { timeout: 10_000 });
  } catch {
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

    try {
      const { stdout } = await execFileAsync(
        "npx",
        ["promptfoo", "eval", "--config", configPath, "--output", "json", "--no-progress-bar"],
        { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
      );

      const output = JSON.parse(stdout) as {
        stats?: { passes: number; total: number; passRate: number };
        results?: { stats?: { passes: number; total: number; passRate: number } };
      };

      const stats = output.stats || output.results?.stats;
      if (!stats) {
        console.error(`[job] eval-runner: no stats in output for team ${team}`);
        continue;
      }

      const result: EvalResult = {
        team,
        passRate: stats.passRate,
        total: stats.total,
        passed: stats.passes,
        failed: stats.total - stats.passes,
      };

      results.push(result);
      console.log(
        `[job] eval-runner: ${team} — ${result.passed}/${result.total} passed (${(result.passRate * 100).toFixed(1)}%)`,
      );
    } catch (err) {
      console.error(`[job] eval-runner: failed to eval team ${team}:`, err);
    }
  }

  // Store results and check for regressions
  let regressions = 0;
  for (const result of results) {
    // Store result
    await query(
      `INSERT INTO pipeline.eval_runs (team, pass_rate, total_tests, passed, failed)
       VALUES ($1, $2, $3, $4, $5)`,
      [result.team, result.passRate, result.total, result.passed, result.failed],
    );

    // Check for regression vs previous run
    const prev = await query<{ pass_rate: number }>(
      `SELECT pass_rate FROM pipeline.eval_runs
       WHERE team = $1
       ORDER BY run_at DESC
       OFFSET 1 LIMIT 1`,
      [result.team],
    );

    if (prev.length > 0) {
      const delta = result.passRate - prev[0].pass_rate;
      if (delta < -REGRESSION_THRESHOLD) {
        regressions++;
        console.log(
          `[job] eval-runner: REGRESSION in ${result.team}: ${(prev[0].pass_rate * 100).toFixed(1)}% → ${(result.passRate * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}%)`,
        );

        await query(
          `INSERT INTO pipeline.tasks (description, task_type, status, target_repo)
           VALUES ($1, 'gap-fill', 'pending', $2)
           ON CONFLICT DO NOTHING`,
          [
            `Eval regression: ${result.team} dropped from ${(prev[0].pass_rate * 100).toFixed(1)}% to ${(result.passRate * 100).toFixed(1)}% (${(delta * 100).toFixed(1)}% regression)`,
            result.team,
          ],
        );
      }
    }
  }

  const summary = `Evaluated ${results.length} teams, ${regressions} regressions detected`;
  console.log(`[job] eval-runner: ${summary}`);
  return summary;
}
