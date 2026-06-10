#!/usr/bin/env node
// Lore test-command interface -- `run`. Runs ONE test file in ITS package's cwd
// with V8 coverage and prints {passed, covered:[{file,startLine,endLine}]} with
// repo-relative paths. The selector is a repo-relative path (e.g.
// `web-ui/src/x.test.tsx`); its first segment is the package vitest runs in.
// coverage_format is json because runTestsRun() JSON.parses stdout locally.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd(); // manifest cwd == repo root
// Covered code we keep: any traceability package's src (a test may cover code in
// its own package; cross-package src is captured only if vitest reports it).
const SRC_RE = /^(?:shared|agent|mcp-server|web-ui)\/src\//;

const id = process.argv[2];
if (!id) {
  console.error("run-test: missing test id");
  process.exit(2);
}
const pkg = id.split("/")[0];
const fileInPkg = id.slice(pkg.length + 1);

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
    { cwd: join(ROOT, pkg), encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "ignore", "ignore"] },
  );
} catch {
  passed = false; // non-zero exit == a failing/erroring test, still report coverage
}

function repoRelative(absolutePath) {
  return absolutePath.startsWith(`${ROOT}/`) ? absolutePath.slice(ROOT.length + 1) : absolutePath;
}

const covered = [];
try {
  const report = JSON.parse(readFileSync(join(reportDir, "coverage-final.json"), "utf-8"));
  const seen = new Set();
  for (const entry of Object.values(report)) {
    const file = repoRelative(entry.path);
    if (!SRC_RE.test(file)) continue;
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue; // COVERS targets real code, not the test itself
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
