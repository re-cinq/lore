#!/usr/bin/env node
/**
 * CLI wrapper for repo-validation — called by entrypoint.sh in K8s Job pods.
 *
 * Usage:
 *   node /validation.js --quick --repo /workspace/repo [--files "file1.ts file2.ts"]
 *   node /validation.js --full  --repo /workspace/repo
 *
 * Exit codes:
 *   0 = all checks passed (or no checks detected)
 *   1 = one or more checks failed
 *
 * Outputs JSON to stdout with the validation result.
 */

import { detectTooling, runValidation, formatValidationOutput } from "./repo-validation.js";

const args = process.argv.slice(2);

const mode = args.includes("--full") ? "full" : "quick";
const repoIdx = args.indexOf("--repo");
const repoRoot = repoIdx >= 0 && args[repoIdx + 1] ? args[repoIdx + 1] : process.cwd();
const filesIdx = args.indexOf("--files");
const changedFiles = filesIdx >= 0 && args[filesIdx + 1]
  ? args[filesIdx + 1].split(/\s+/).filter(Boolean)
  : undefined;

const tooling = detectTooling(repoRoot);

if (tooling.language === "unknown") {
  console.log(JSON.stringify({ passed: true, steps: [], language: "unknown", message: "No tooling detected" }));
  process.exit(0);
}

const steps = mode === "full" ? tooling.fullChecks : tooling.quickChecks;

if (steps.length === 0) {
  console.log(JSON.stringify({ passed: true, steps: [], language: tooling.language, message: "No checks configured" }));
  process.exit(0);
}

console.error(`[validation] ${mode} checks for ${tooling.language} repo: ${steps.map((s) => s.name).join(", ")}`);

const result = runValidation(repoRoot, steps, changedFiles);

console.log(JSON.stringify({
  passed: result.passed,
  language: tooling.language,
  steps: result.steps.map((s) => ({ name: s.name, passed: s.passed, durationMs: s.durationMs })),
}));

if (!result.passed) {
  console.error(formatValidationOutput(result));
  process.exit(1);
}
