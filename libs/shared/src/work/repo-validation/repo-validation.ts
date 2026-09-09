/** Repo Validation — polyglot tooling detection + deterministic validation (Stripe Minions-inspired); called by both the local runner and GKE runner after the agent completes, before commit/push. */

import { execSync } from "node:child_process";

export { detectTooling } from "./repo-validation-detect.js";

// ── Types ───────────────────────────────────────────────────────────

export interface ValidationStep {
  name: string;
  command: string;
  timeoutMs: number;
  /** Command scoped to changed files (`{files}` placeholder); derived from the repo's own lint script since `npm run lint --silent` has no "." to replace (run b6ed264c, 2026-08-30 hit the budget unscoped). */
  scopedCommand?: string;
}

export interface RepoTooling {
  language: "node" | "go" | "python" | "rust" | "unknown";
  quickChecks: ValidationStep[];
  fullChecks: ValidationStep[];
}

export interface StepResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface ValidationResult {
  passed: boolean;
  steps: StepResult[];
}

// ── Execution ───────────────────────────────────────────────────────

export async function runValidation(
  repoRoot: string,
  steps: ValidationStep[],
  changedFiles?: string[],
  exec: ValidationExec = localValidationExec,
): Promise<ValidationResult> {
  if (steps.length === 0) {
    return { passed: true, steps: [] };
  }

  const results: StepResult[] = [];

  // Sequential, not parallel: the steps share one working tree, and two toolchains writing caches into it at once is how a green run turns red on the retry.
  for (const step of steps) {
    results.push(await runStep(step, { repoRoot, changedFiles, exec }));
  }

  return { passed: results.every((r) => r.passed), steps: results };
}

/** One validation step. A step whose command matches none of the changed files is REPORTED as skipped rather than dropped: "eslint had nothing to check" and "eslint never ran" look identical in a bare pass, and only one of them is fine. */
interface StepDeps {
  repoRoot: string;
  changedFiles: string[] | undefined;
  exec: ValidationExec;
}

async function runStep(
  step: ValidationStep,
  { repoRoot, changedFiles, exec }: StepDeps,
): Promise<StepResult> {
  const start = Date.now();
  const command = resolveStepCommand(step, changedFiles);

  if (command === undefined) {
    return skippedStepResult(step.name);
  }
  const { output, passed } = await exec(command, {
    cwd: repoRoot,
    timeoutMs: step.timeoutMs,
  });

  return {
    name: step.name,
    passed,
    output: truncateOutput(output),
    durationMs: Date.now() - start,
  };
}

/** Runs validation steps sequentially; does NOT bail on first failure — collects all errors. */
// undefined = skip: the step's file filter matched none of the changed files
function resolveStepCommand(
  step: ValidationStep,
  changedFiles: string[] | undefined,
): string | undefined {
  if (!changedFiles || changedFiles.length === 0) {
    return step.command;
  }
  const relevantFiles = filterFilesByStep(step.name, changedFiles);

  if (relevantFiles.length === 0) {
    return undefined;
  }

  return step.scopedCommand
    ? step.scopedCommand.replaceAll("{files}", quoteFiles(relevantFiles))
    : scopeCommandToFiles(step.name, step.command, relevantFiles);
}

function skippedStepResult(name: string): StepResult {
  return {
    name,
    passed: true,
    output: "skipped (no matching files)",
    durationMs: 0,
  };
}

const MAX_OUTPUT_CHARS = 5000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }

  return (
    output.substring(output.length - MAX_OUTPUT_CHARS) + "\n...(truncated)"
  );
}

/** How a validation command is executed — default runs locally; the BYO sidecar (ADR-025) injects an exec that runs it in the repo's toolchain container over the relay. */
export type ValidationExec = (
  command: string,
  opts: { cwd: string; timeoutMs?: number },
) => Promise<{ output: string; passed: boolean }>;

/** Default exec — runs the command locally via `execSync`. */
export const localValidationExec: ValidationExec = async (
  command,
  { cwd, timeoutMs },
) => {
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
    });

    return { output: output || "", passed: true };
  } catch (err: unknown) {
    return { output: execFailureOutput(err), passed: false };
  }
};

function execFailureOutput(err: unknown): string {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  const combined = [e.stdout ?? "", e.stderr ?? ""].join("\n").trim();

  return combined || e.message || "unknown error";
}

// ── File scoping helpers ────────────────────────────────────────────

const FILE_EXTENSIONS: Record<string, string[] | undefined> = {
  lint: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  eslint: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  tsc: [".ts", ".tsx"],
  typecheck: [".ts", ".tsx"],
  ruff: [".py"],
  mypy: [".py"],
};

function filterFilesByStep(stepName: string, files: string[]): string[] {
  const exts = FILE_EXTENSIONS[stepName];

  // For build/test steps, don't filter
  if (!exts) {
    return files;
  }

  return files.filter((f) => exts.some((ext) => f.endsWith(ext)));
}

/** Scope a lint-style command to specific files instead of the whole repo, avoiding false positives from pre-existing lint errors. */
function scopeCommandToFiles(
  stepName: string,
  command: string,
  files: string[],
): string {
  // Only the bare tool invocations this module writes (eslint/ruff); a `lint` step's `npm run lint --silent` has no "." and is scoped via `scopedCommand` instead.
  if (stepName === "eslint" || stepName === "ruff") {
    return command.replace(/\s+\.$/, ` ${quoteFiles(files)}`);
  }

  return command;
}

const quoteFiles = (files: string[]): string =>
  files.map((f) => `"${f}"`).join(" ");

/** Formats validation results into a human-readable summary for error messages and retry prompts. */
export function formatValidationOutput(result: ValidationResult): string {
  const lines: string[] = [];

  for (const step of result.steps) {
    const icon = step.passed ? "PASS" : "FAIL";

    lines.push(`[${icon}] ${step.name} (${step.durationMs}ms)`);

    if (!step.passed) {
      lines.push(step.output);
      lines.push("");
    }
  }

  return lines.join("\n");
}
