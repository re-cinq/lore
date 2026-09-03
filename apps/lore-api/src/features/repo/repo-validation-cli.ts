#!/usr/bin/env node
/** CLI wrapper for repo-validation — validates code via lint/typecheck; outputs JSON to stdout. */

// Subpath import for esbuild bundling into /validation.js without heavy deps (dgraph/tree-sitter)
import {
  detectTooling,
  runValidation,
  formatValidationOutput,
} from "@re-cinq/lore-shared/repo-validation/repo-validation.js";

const args = process.argv.slice(2);

const mode = args.includes("--full") ? "full" : "quick";
const repoIdx = args.indexOf("--repo");
const repoRoot =
  repoIdx >= 0 && args[repoIdx + 1] ? args[repoIdx + 1] : process.cwd();
const filesIdx = args.indexOf("--files");
const changedFiles =
  filesIdx >= 0 && args[filesIdx + 1]
    ? args[filesIdx + 1].split(/\s+/).filter(Boolean)
    : undefined;

const tooling = detectTooling(repoRoot);

if (tooling.language === "unknown") {
  console.log(
    JSON.stringify({
      passed: true,
      steps: [],
      language: "unknown",
      message: "No tooling detected",
    }),
  );
  process.exit(0);
}

const steps = mode === "full" ? tooling.fullChecks : tooling.quickChecks;

if (steps.length === 0) {
  console.log(
    JSON.stringify({
      passed: true,
      steps: [],
      language: tooling.language,
      message: "No checks configured",
    }),
  );
  process.exit(0);
}

console.error(
  `[validation] ${mode} checks for ${tooling.language} repo: ${steps.map((s) => s.name).join(", ")}`,
);

const result = await runValidation(repoRoot, steps, changedFiles);

console.log(
  JSON.stringify({
    passed: result.passed,
    language: tooling.language,
    steps: result.steps.map((s) => ({
      name: s.name,
      passed: s.passed,
      durationMs: s.durationMs,
    })),
  }),
);

if (!result.passed) {
  console.error(formatValidationOutput(result));
  process.exit(1);
}
