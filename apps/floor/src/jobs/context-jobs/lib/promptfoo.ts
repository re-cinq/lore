/**
 * One place to run `promptfoo eval` and read its pass rate. The eval-runner and
 * context-core-builder jobs each hand-rolled the same execFileAsync invocation +
 * dual-path stats parse; this single-sources them and distinguishes a missing
 * config from an execution failure (context-core-builder used to log every crash
 * as "no eval config, skipping").
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 10 * 1024 * 1024;

export interface PromptfooStats {
  passRate: number;
  passes: number | null;
  total: number | null;
}

export type PromptfooEvalResult =
  | { ok: true; stats: PromptfooStats }
  | { ok: false; reason: "config-missing" }
  | { ok: false; reason: "exec-failed"; error: unknown }
  | { ok: false; reason: "no-stats" };

/** Pure parse of `promptfoo eval --output json` stdout — stats live at the root
 *  or under `results`, depending on the promptfoo version. null when neither. */
export function parsePromptfooStats(stdout: string): PromptfooStats | null {
  let output: {
    stats?: { passRate?: number; passes?: number; total?: number };
    results?: { stats?: { passRate?: number; passes?: number; total?: number } };
  };
  try {
    output = JSON.parse(stdout);
  } catch {
    return null;
  }
  const stats = output.stats ?? output.results?.stats;
  if (!stats || typeof stats.passRate !== "number") return null;
  return { passRate: stats.passRate, passes: stats.passes ?? null, total: stats.total ?? null };
}

/** Is the promptfoo CLI runnable? (`npx promptfoo --version`). */
export async function isPromptfooAvailable(): Promise<boolean> {
  try {
    await execFileAsync("npx", ["promptfoo", "--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function runPromptfooEval(opts: {
  configPath: string;
  extraArgs?: string[];
  timeoutMs?: number;
}): Promise<PromptfooEvalResult> {
  // Check the config exists BEFORE exec so a genuinely missing config is a
  // distinct, non-alarming outcome — separate from a crash/timeout.
  const configExists = await access(opts.configPath).then(
    () => true,
    () => false,
  );
  if (!configExists) return { ok: false, reason: "config-missing" };

  try {
    const { stdout } = await execFileAsync(
      "npx",
      ["promptfoo", "eval", "--config", opts.configPath, "--output", "json", "--no-progress-bar", ...(opts.extraArgs ?? [])],
      { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
    );
    const stats = parsePromptfooStats(stdout);
    return stats ? { ok: true, stats } : { ok: false, reason: "no-stats" };
  } catch (error) {
    return { ok: false, reason: "exec-failed", error };
  }
}
