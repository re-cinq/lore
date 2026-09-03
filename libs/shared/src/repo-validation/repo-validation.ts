/**
 * Repo Validation — polyglot tooling detection and deterministic validation.
 *
 * Detects what lint/typecheck/test tools a repo has (from package.json,
 * go.mod, pyproject.toml, Cargo.toml) and runs them as mandatory pipeline
 * stages. Inspired by Stripe Minions' "deterministic interleaving".
 *
 * Both the local runner (monitorTask) and GKE runner (entrypoint.sh via CLI)
 * call into this module after the agent completes, before commit/push.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────

export interface ValidationStep {
  name: string;
  command: string;
  timeoutMs: number;
  /**
   * The command to run when the step is scoped to changed files, with
   * `{files}` standing for the quoted file list. Derived at detection time
   * from the repo's own script, because scoping cannot be done to the npm
   * command: `npm run lint --silent` carries no "." to replace — the "." lives
   * inside package.json — so a lint SCRIPT was never scoped at all, and on a
   * monorepo `eslint .` then hit the budget (run b6ed264c, 2026-08-30:
   * `spawnSync /bin/sh ETIMEDOUT`). Absent for a linter this module does not
   * know how to rewrite; the step then runs unscoped.
   */
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

// ── Detection ───────────────────────────────────────────────────────

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Whether the manifest declares a workspaces monorepo, in either spelling: npm's
 * array of globs, or the `{ packages: [...] }` object Yarn uses and that plenty
 * of npm-installed repos still carry.
 */
// Vitest and Jest support --run/--bail for fast failure
function fastFailTestCommand(testScript: string): string {
  if (testScript.includes("vitest")) {
    return "npm run test --silent -- --run";
  }

  if (testScript.includes("jest")) {
    return "npm run test --silent -- --bail";
  }

  return "npm run test --silent";
}

// A WORKSPACES repo must COMPILE before it lints: a sibling's `dist/` is
// what the others import, and an install does not produce it. Run
// b219a4f1 (2026-08-30) died on exactly that — `npm ci` succeeded and
// eslint then failed with `cannot import
// @re-cinq/lore-shared/spec-status.js`, because this repo's own ESLint
// plugin imports a workspace package's compiled output. Both implement
// nodes succeeded and both validate nodes failed identically, so the retry
// bought a second 40-minute implementation against a fault no
// implementation could fix.
//
// The build it ALREADY has is moved, never duplicated — a second step
// running the same command would compile the repo twice on every fresh
// clone — and it carries a cold-clone budget, since compiling every
// workspace from nothing is not the 60-second job a warm rebuild is.
//
// Gated on `workspaces`: a single-package repo's lint reads source, so
// compiling first buys nothing and costs every validate the time.
function promoteWorkspaceBuildFirst(
  quick: ValidationStep[],
  pkg: Record<string, unknown>,
): void {
  const buildAt = declaresWorkspaces(pkg)
    ? quick.findIndex((step) => step.name === "build")
    : -1;

  if (buildAt < 0) {
    return;
  }
  // Read before removing: destructuring the splice result would spread
  // `undefined` if the index guard above ever stopped holding, and a step
  // with no command reads as a check that passed.
  const build = quick[buildAt];

  quick.splice(buildAt, 1);
  quick.unshift({ ...build, timeoutMs: 300_000 });
}

function declaresWorkspaces(pkg: Record<string, unknown>): boolean {
  const workspaces = pkg.workspaces;

  if (Array.isArray(workspaces)) {
    return true;
  }

  if (typeof workspaces !== "object" || workspaces === null) {
    return false;
  }

  return Array.isArray((workspaces as { packages?: unknown }).packages);
}

/**
 * The scoped form of a repo's lint script, or null when this module does not
 * know how to scope it. Only eslint is understood: its "." argument is the
 * tree, so replacing that one token with the changed files keeps every other
 * flag the script carries (`--max-warnings 0`, a config path) intact. Run via
 * `npx` so the script's binary resolves from node_modules/.bin exactly as
 * `npm run` would resolve it.
 */
function scopedLintCommand(script: string): string | null {
  // The script must START with the eslint binary. A script prefixed with an
  // environment assignment (`NODE_OPTIONS=... eslint .`) or chained through
  // another tool is deliberately left unscoped: rewriting it would mean
  // re-implementing the shell, and unscoped is the safe default.
  if (!/^eslint(\s|$)/.test(script.trim())) {
    return null;
  }
  // Exactly the bare "." token — the tree root — and only the first one.
  // `.ts` in `--ext .ts` and `./extra` are not that token and stay; a script
  // with no bare "." has nothing to scope.
  const scoped = script.trim().replace(/(^|\s)\.(?=\s|$)/, "$1{files}");

  return scoped === script.trim() ? null : `npx ${scoped}`;
}

function hasEslintConfig(repoRoot: string): boolean {
  const isFlatConfig =
    existsSync(join(repoRoot, "eslint.config.js")) ||
    existsSync(join(repoRoot, "eslint.config.mjs"));
  const isLegacyConfig =
    existsSync(join(repoRoot, ".eslintrc.json")) ||
    existsSync(join(repoRoot, ".eslintrc.js"));

  return isFlatConfig || isLegacyConfig;
}

function detectNode(repoRoot: string): RepoTooling | null {
  const pkgPath = join(repoRoot, "package.json");
  const pkg = readJsonFile(pkgPath);

  if (!pkg) {
    return null;
  }

  const scripts = (pkg.scripts || {}) as Record<string, string>;
  const quick: ValidationStep[] = [];
  const full: ValidationStep[] = [];

  // Lint
  // 120s, not 30: scoping is best-effort (a diff that cannot be derived runs
  // the whole tree), and unscoped `eslint .` on a monorepo measures ~37s at
  // 200% CPU on a warm laptop — minutes in a one-CPU pod with a cold cache.
  const lintScript = scripts.lint;

  if (lintScript) {
    const scopedCommand = scopedLintCommand(lintScript);

    quick.push({
      name: "lint",
      command: "npm run lint --silent",
      ...(scopedCommand ? { scopedCommand } : {}),
      timeoutMs: 120_000,
    });
  }

  if (!lintScript && hasEslintConfig(repoRoot)) {
    quick.push({
      name: "eslint",
      command: "npx eslint --quiet .",
      timeoutMs: 120_000,
    });
  }

  // Typecheck
  const typecheckScript = scripts.typecheck;

  if (typecheckScript) {
    quick.push({
      name: "typecheck",
      command: "npm run typecheck --silent",
      timeoutMs: 60_000,
    });
  }

  if (!typecheckScript && existsSync(join(repoRoot, "tsconfig.json"))) {
    quick.push({ name: "tsc", command: "npx tsc --noEmit", timeoutMs: 60_000 });
  }

  // Build (quick check — catches import errors)
  if (scripts.build) {
    quick.push({
      name: "build",
      command: "npm run build --silent",
      timeoutMs: 60_000,
    });
  }

  // Test (full check only — too slow for pre-flight)
  if (scripts.test) {
    full.push({
      name: "test",
      command: fastFailTestCommand(scripts.test as string),
      timeoutMs: 120_000,
    });
  }

  // A validate station clones fresh, so node_modules is absent and every
  // check above dies in ~1s on missing binaries — install first, but only
  // when there is something to check afterwards.
  if (
    (quick.length > 0 || full.length > 0) &&
    !existsSync(join(repoRoot, "node_modules"))
  ) {
    promoteWorkspaceBuildFirst(quick, pkg);
    quick.unshift({
      name: "install",
      command: existsSync(join(repoRoot, "package-lock.json"))
        ? "npm ci --no-audit --no-fund"
        : "npm install --no-audit --no-fund",
      timeoutMs: 300_000,
    });
  }

  // Full checks include quick checks + test
  return {
    language: "node",
    quickChecks: quick,
    fullChecks: [...quick, ...full],
  };
}

function detectGo(repoRoot: string): RepoTooling | null {
  if (!existsSync(join(repoRoot, "go.mod"))) {
    return null;
  }

  return {
    language: "go",
    quickChecks: [
      { name: "go-vet", command: "go vet ./...", timeoutMs: 30_000 },
      { name: "go-build", command: "go build ./...", timeoutMs: 60_000 },
    ],
    fullChecks: [
      { name: "go-vet", command: "go vet ./...", timeoutMs: 30_000 },
      { name: "go-build", command: "go build ./...", timeoutMs: 60_000 },
      { name: "go-test", command: "go test ./...", timeoutMs: 120_000 },
    ],
  };
}

function detectPython(repoRoot: string): RepoTooling | null {
  const hasPyproject = existsSync(join(repoRoot, "pyproject.toml"));
  const hasSetupCfg = existsSync(join(repoRoot, "setup.cfg"));
  const hasRequirements = existsSync(join(repoRoot, "requirements.txt"));

  if (!hasPyproject && !hasSetupCfg && !hasRequirements) {
    return null;
  }

  const quick: ValidationStep[] = [];
  const full: ValidationStep[] = [];

  // Read pyproject.toml as text to check for tool presence
  let pyproject = "";

  if (hasPyproject) {
    try {
      pyproject = readFileSync(join(repoRoot, "pyproject.toml"), "utf-8");
    } catch {
      /* */
    }
  }

  // Ruff (fast linter)
  if (
    pyproject.includes("[tool.ruff]") ||
    existsSync(join(repoRoot, "ruff.toml"))
  ) {
    quick.push({ name: "ruff", command: "ruff check .", timeoutMs: 15_000 });
  }

  // Mypy
  if (
    pyproject.includes("[tool.mypy]") ||
    existsSync(join(repoRoot, "mypy.ini"))
  ) {
    quick.push({ name: "mypy", command: "mypy .", timeoutMs: 60_000 });
  }

  // Pytest (full only)
  if (
    pyproject.includes("[tool.pytest]") ||
    existsSync(join(repoRoot, "pytest.ini"))
  ) {
    full.push({
      name: "pytest",
      command: "pytest --tb=short -q",
      timeoutMs: 120_000,
    });
  }

  if (quick.length === 0 && full.length === 0) {
    return null;
  }

  return {
    language: "python",
    quickChecks: quick,
    fullChecks: [...quick, ...full],
  };
}

function detectRust(repoRoot: string): RepoTooling | null {
  if (!existsSync(join(repoRoot, "Cargo.toml"))) {
    return null;
  }

  return {
    language: "rust",
    quickChecks: [
      { name: "cargo-check", command: "cargo check", timeoutMs: 60_000 },
      {
        name: "cargo-clippy",
        command: "cargo clippy -- -D warnings",
        timeoutMs: 60_000,
      },
    ],
    fullChecks: [
      { name: "cargo-check", command: "cargo check", timeoutMs: 60_000 },
      {
        name: "cargo-clippy",
        command: "cargo clippy -- -D warnings",
        timeoutMs: 60_000,
      },
      { name: "cargo-test", command: "cargo test", timeoutMs: 120_000 },
    ],
  };
}

/**
 * Detects what validation tooling is available in a repo by scanning
 * for config files (package.json, go.mod, pyproject.toml, Cargo.toml).
 */
export function detectTooling(repoRoot: string): RepoTooling {
  // Try detectors in order of likelihood (Node is most common in Lore repos)
  const result =
    detectNode(repoRoot) ??
    detectGo(repoRoot) ??
    detectPython(repoRoot) ??
    detectRust(repoRoot);

  return result || { language: "unknown", quickChecks: [], fullChecks: [] };
}

// ── Execution ───────────────────────────────────────────────────────

const MAX_OUTPUT_CHARS = 5000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }

  return (
    output.substring(output.length - MAX_OUTPUT_CHARS) + "\n...(truncated)"
  );
}

/**
 * How a single validation command is executed. Default runs it locally
 * (`localValidationExec`); the BYO sidecar (ADR-025) injects an exec that runs
 * the command in the repo's toolchain container over the relay.
 */
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
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout || "", e.stderr || ""].join("\n").trim();

    return { output: output || e.message || "unknown error", passed: false };
  }
};

/**
 * Runs validation steps sequentially. Returns as soon as all steps have run
 * (does NOT bail on first failure — collects all errors). Each command runs
 * through `exec` (local by default; relay-backed for BYO).
 */
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

  for (const step of steps) {
    const start = Date.now();
    // For eslint/ruff, scope to changed files if available
    const command = resolveStepCommand(step, changedFiles);

    if (command === undefined) {
      results.push({
        name: step.name,
        passed: true,
        output: "skipped (no matching files)",
        durationMs: 0,
      });
      continue;
    }

    const { output, passed } = await exec(command, {
      cwd: repoRoot,
      timeoutMs: step.timeoutMs,
    });

    results.push({
      name: step.name,
      passed,
      output: truncateOutput(output),
      durationMs: Date.now() - start,
    });
  }

  return {
    passed: results.every((r) => r.passed),
    steps: results,
  };
}

// ── File scoping helpers ────────────────────────────────────────────

const FILE_EXTENSIONS: Record<string, string[]> = {
  lint: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  eslint: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  tsc: [".ts", ".tsx"],
  typecheck: [".ts", ".tsx"],
  ruff: [".py"],
  mypy: [".py"],
};

function filterFilesByStep(stepName: string, files: string[]): string[] {
  const exts = FILE_EXTENSIONS[stepName];

  if (!exts) {
    return files;
  } // For build/test steps, don't filter

  return files.filter((f) => exts.some((ext) => f.endsWith(ext)));
}

/**
 * For lint-style tools, scope the command to specific files instead of
 * scanning the entire repo. This avoids false positives from pre-existing
 * lint errors the agent didn't introduce.
 */
function scopeCommandToFiles(
  stepName: string,
  command: string,
  files: string[],
): string {
  // Only scope lint/eslint and ruff — typecheck/build/test need full project
  // Only the BARE tool invocations this module itself writes (`npx eslint
  // --quiet .`, ruff). A `lint` step is never here: its command is always
  // `npm run lint --silent`, which carries no "." to replace — that step is
  // scoped through its derived `scopedCommand` or not at all.
  if (stepName === "eslint" || stepName === "ruff") {
    return command.replace(/\s+\.$/, ` ${quoteFiles(files)}`);
  }

  return command;
}

const quoteFiles = (files: string[]): string =>
  files.map((f) => `"${f}"`).join(" ");

/**
 * Formats validation results into a human-readable summary for error
 * messages and retry prompts.
 */
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
