#!/usr/bin/env node
// Lore test-command interface -- `run`. Runs ONE test file with V8 coverage and
// prints {passed, covered:[{file,startLine,endLine}]} with repo-relative paths.
// coverage_format is json because runTestsRun() JSON.parses stdout locally; it
// never parses lcov (only the HTTP /coverage endpoint does).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PKG = process.env.LORE_TRACE_PKG || "shared";
const id = process.argv[2];
if (!id) {
  console.error("run-test: missing test id");
  process.exit(2);
}
const fileInPkg = id.startsWith(`${PKG}/`) ? id.slice(PKG.length + 1) : id;

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
      // mcp-server's 100% gate) -- zero them so exit code == test pass/fail,
      // not threshold pass/fail.
      "--coverage.thresholds.lines=0",
      "--coverage.thresholds.functions=0",
      "--coverage.thresholds.statements=0",
      "--coverage.thresholds.branches=0",
      `--coverage.reportsDirectory=${reportDir}`,
    ],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "ignore", "ignore"] },
  );
} catch {
  passed = false; // non-zero exit == a failing/erroring test, still report coverage
}

function repoRelative(absolutePath) {
  const marker = `/${PKG}/`;
  const at = absolutePath.indexOf(marker);
  return at === -1 ? absolutePath : absolutePath.slice(at + 1);
}

const covered = [];
try {
  const report = JSON.parse(readFileSync(join(reportDir, "coverage-final.json"), "utf-8"));
  const seen = new Set();
  for (const entry of Object.values(report)) {
    const file = repoRelative(entry.path);
    if (!file.startsWith(`${PKG}/src/`)) continue;
    if (file.endsWith(".test.ts")) continue; // COVERS targets real code, not the test itself
    for (const [statementId, range] of Object.entries(entry.statementMap)) {
      if ((entry.s[statementId] ?? 0) <= 0) continue;
      const startLine = range.start.line;
      const endLine = range.end.line ?? startLine;
      const key = `${file}:${startLine}:${endLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      covered.push({ file, startLine, endLine });
    }
  }
} catch {
  // no coverage file (e.g. vitest crashed before writing one) -> empty covered
} finally {
  rmSync(reportDir, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify({ passed, covered }));
