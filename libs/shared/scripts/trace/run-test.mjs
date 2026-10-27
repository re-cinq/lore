#!/usr/bin/env node
// Lore test-command interface -- `run`. Runs ONE test file in ITS package's cwd
// with V8 coverage and prints {passed, covered:[{file,startLine,endLine}]} with
// repo-relative paths. The selector is a repo-relative path (e.g.
// `apps/web-ui/src/x.test.tsx`); its first two segments are the package vitest
// runs in (the apps/ + libs/ layout makes every package path two segments).
// coverage_format is json because runTestsRun() JSON.parses stdout locally.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coveredRanges } from "../../dist/domain/spec-trace/covered-ranges.js";

const ROOT = process.cwd(); // manifest cwd == repo root

const id = process.argv[2];

if (!id) {
  console.error("run-test: missing test id");
  process.exit(2);
}
const segments = id.split("/");
const pkg = segments.slice(0, 2).join("/");
const fileInPkg = segments.slice(2).join("/");

const reportDir = mkdtempSync(join(tmpdir(), "lore-trace-cov-"));

let passed = true;

try {
  execFileSync(
    "npx",
    [
      "vitest",
      "run",
      fileInPkg,
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=json",
      "--coverage.include=src/**",
      // A single file never meets a repo's global coverage thresholds (e.g.
      // mcp-server's 100% gate) -- zero them so exit code == test pass/fail.
      "--coverage.thresholds.lines=0",
      "--coverage.thresholds.functions=0",
      "--coverage.thresholds.statements=0",
      "--coverage.thresholds.branches=0",
      `--coverage.reportsDirectory=${reportDir}`,
    ],
    {
      cwd: join(ROOT, pkg),
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
} catch {
  passed = false; // non-zero exit == a failing/erroring test, still report coverage
}

let covered = [];

try {
  covered = coveredRanges(
    JSON.parse(readFileSync(join(reportDir, "coverage-final.json"), "utf-8")),
    ROOT,
  );
} catch {
  // no coverage file (e.g. vitest crashed before writing one) -> empty covered
} finally {
  rmSync(reportDir, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify({ passed, covered }));
