/** One place to run `promptfoo eval` and read its pass rate, single-sourcing what eval-runner and context-core-builder used to hand-roll separately, and distinguishing a missing config from an execution failure. */

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

type RawPromptfooStats = { passRate?: number; passes?: number; total?: number };
type RawPromptfooOutput = {
  stats?: RawPromptfooStats;
  results?: { stats?: RawPromptfooStats };
};

function rawStats(output: RawPromptfooOutput): RawPromptfooStats | undefined {
  return output.stats ?? output.results?.stats;
}

function toPromptfooStats(stats: {
  passRate: number;
  passes?: number;
  total?: number;
}): PromptfooStats {
  return {
    passRate: stats.passRate,
    passes: stats.passes ?? null,
    total: stats.total ?? null,
  };
}

/** Pure parse of `promptfoo eval --output json` stdout — stats live at the root or under `results` depending on the promptfoo version; null when neither. */
export function parsePromptfooStats(stdout: string): PromptfooStats | null {
  let output: RawPromptfooOutput;

  try {
    output = JSON.parse(stdout);
  } catch {
    return null;
  }
  const stats = rawStats(output);

  if (!stats || typeof stats.passRate !== "number") {
    return null;
  }

  return toPromptfooStats({ ...stats, passRate: stats.passRate });
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
  // Check the config exists BEFORE exec so a missing config is a distinct, non-alarming outcome separate from a crash/timeout.
  const configExists = await access(opts.configPath).then(
    () => true,
    () => false,
  );

  if (!configExists) {
    return { ok: false, reason: "config-missing" };
  }

  try {
    const { stdout } = await execFileAsync(
      "npx",
      [
        "promptfoo",
        "eval",
        "--config",
        opts.configPath,
        "--output",
        "json",
        "--no-progress-bar",
        ...(opts.extraArgs ?? []),
      ],
      { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
    );
    const stats = parsePromptfooStats(stdout);

    return stats ? { ok: true, stats } : { ok: false, reason: "no-stats" };
  } catch (error) {
    return { ok: false, reason: "exec-failed", error };
  }
}
