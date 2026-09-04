/** Repo Validation — polyglot tooling detection + deterministic validation (Stripe Minions-inspired); called by both the local runner and GKE runner after the agent completes, before commit/push. */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

// ── Detection ───────────────────────────────────────────────────────

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** Whether the manifest declares a workspaces monorepo — npm's array of globs, or Yarn's `{ packages: [...] }` object. */
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

// A WORKSPACES repo must COMPILE before it lints — a sibling's `dist/` is what others import and install doesn't produce it (run b219a4f1, 2026-08-30, died on exactly that). Gated on `workspaces`: a single-package repo's lint reads source.
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
  // Read before removing: a splice-result destructure would spread `undefined` if the index guard ever stopped holding.
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

/** The scoped form of a repo's lint script, or null if unscopeable. Only eslint is understood: its "." tree-root token is replaced, keeping other flags intact; run via `npx`. */
function scopedLintCommand(script: string): string | null {
  // Must START with the eslint binary — a script prefixed with an env assignment or chained through another tool is left unscoped (safe default).
  if (!/^eslint(\s|$)/.test(script.trim())) {
    return null;
  }
  // Exactly the bare "." tree-root token, first occurrence only — `.ts` in `--ext .ts` and `./extra` are not that token.
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

// Lint: 120s not 30 — scoping is best-effort and unscoped `eslint .` on a monorepo measures ~37s warm, minutes cold in a one-CPU pod.
function addLintStep(
  quick: ValidationStep[],
  scripts: Record<string, string>,
  repoRoot: string,
): void {
  const lintScript = scripts.lint;

  if (lintScript) {
    const scopedCommand = scopedLintCommand(lintScript);

    quick.push({
      name: "lint",
      command: "npm run lint --silent",
      ...(scopedCommand ? { scopedCommand } : {}),
      timeoutMs: 120_000,
    });

    return;
  }

  if (hasEslintConfig(repoRoot)) {
    quick.push({
      name: "eslint",
      command: "npx eslint --quiet .",
      timeoutMs: 120_000,
    });
  }
}

function addTypecheckStep(
  quick: ValidationStep[],
  scripts: Record<string, string>,
  repoRoot: string,
): void {
  if (scripts.typecheck) {
    quick.push({
      name: "typecheck",
      command: "npm run typecheck --silent",
      timeoutMs: 60_000,
    });

    return;
  }

  if (existsSync(join(repoRoot, "tsconfig.json"))) {
    quick.push({ name: "tsc", command: "npx tsc --noEmit", timeoutMs: 60_000 });
  }
}

// Build is a quick check — it catches import errors.
function addBuildStep(
  quick: ValidationStep[],
  scripts: Record<string, string>,
): void {
  if (scripts.build) {
    quick.push({
      name: "build",
      command: "npm run build --silent",
      timeoutMs: 60_000,
    });
  }
}

// Test is a full check only — too slow for pre-flight.
function addTestStep(
  full: ValidationStep[],
  scripts: Record<string, string>,
): void {
  if (scripts.test) {
    full.push({
      name: "test",
      command: fastFailTestCommand(scripts.test as string),
      timeoutMs: 120_000,
    });
  }
}

// A validate station clones fresh (no node_modules) — install first, but only when there's something to check afterwards.
function addInstallStepIfNeeded(
  quick: ValidationStep[],
  full: ValidationStep[],
  pkg: Record<string, unknown>,
  repoRoot: string,
): void {
  if (
    (quick.length === 0 && full.length === 0) ||
    existsSync(join(repoRoot, "node_modules"))
  ) {
    return;
  }
  promoteWorkspaceBuildFirst(quick, pkg);
  quick.unshift({
    name: "install",
    command: existsSync(join(repoRoot, "package-lock.json"))
      ? "npm ci --no-audit --no-fund"
      : "npm install --no-audit --no-fund",
    timeoutMs: 300_000,
  });
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

  addLintStep(quick, scripts, repoRoot);
  addTypecheckStep(quick, scripts, repoRoot);
  addBuildStep(quick, scripts);
  addTestStep(full, scripts);
  addInstallStepIfNeeded(quick, full, pkg, repoRoot);

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

// Read pyproject.toml as text to check for tool presence; a missing/unreadable file just means no declared tools.
function readPyprojectText(repoRoot: string, hasPyproject: boolean): string {
  if (!hasPyproject) {
    return "";
  }

  try {
    return readFileSync(join(repoRoot, "pyproject.toml"), "utf-8");
  } catch {
    return "";
  }
}

// Ruff (fast linter)
function addRuffStep(
  quick: ValidationStep[],
  pyproject: string,
  repoRoot: string,
): void {
  if (
    pyproject.includes("[tool.ruff]") ||
    existsSync(join(repoRoot, "ruff.toml"))
  ) {
    quick.push({ name: "ruff", command: "ruff check .", timeoutMs: 15_000 });
  }
}

function addMypyStep(
  quick: ValidationStep[],
  pyproject: string,
  repoRoot: string,
): void {
  if (
    pyproject.includes("[tool.mypy]") ||
    existsSync(join(repoRoot, "mypy.ini"))
  ) {
    quick.push({ name: "mypy", command: "mypy .", timeoutMs: 60_000 });
  }
}

// Pytest is a full check only.
function addPytestStep(
  full: ValidationStep[],
  pyproject: string,
  repoRoot: string,
): void {
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
  const pyproject = readPyprojectText(repoRoot, hasPyproject);

  addRuffStep(quick, pyproject, repoRoot);
  addMypyStep(quick, pyproject, repoRoot);
  addPytestStep(full, pyproject, repoRoot);

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

/** Detects available validation tooling by scanning for config files (package.json, go.mod, pyproject.toml, Cargo.toml). */
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

/** How a validation command is executed — default runs locally; the BYO sidecar (ADR-025) injects an exec that runs it in the repo's toolchain container over the relay. */
export type ValidationExec = (
  command: string,
  opts: { cwd: string; timeoutMs?: number },
) => Promise<{ output: string; passed: boolean }>;

function execFailureOutput(err: unknown): string {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  const combined = [e.stdout ?? "", e.stderr ?? ""].join("\n").trim();

  return combined || e.message || "unknown error";
}

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
