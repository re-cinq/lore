/** Polyglot tooling detection for repo validation — scans for config files (package.json, go.mod, pyproject.toml, Cargo.toml) and builds the quick/full check step lists. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoTooling, ValidationStep } from "./repo-validation.js";

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
