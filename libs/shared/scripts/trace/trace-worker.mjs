#!/usr/bin/env node
// The worker behind `run_many`: ONE vitest for one package, re-running each of
// the given test files in it with coverage. A re-run skips what a fresh
// `vitest run <file> --coverage` pays per file -- booting vitest and vite, and
// remapping every source file the test never loaded to report it as 0% -- which
// was 96% of the test report's time. Isolation per file is the package's own
// setting, as with `run`. It runs from the package directory, as `run` does:
// tests resolve fixtures from process.cwd().
//
// Usage: trace-worker.mjs <repo root> <package> <files.json> <out.json>
// files.json holds repo-relative test files; out.json receives
// {file: {passed, covered}} for every file this package's vitest knows. The
// answer goes to a file, not stdout, which the tests themselves write to.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { coveredRanges } from "../../dist/domain/spec-trace/covered-ranges.js";

const [root, pkg, filesPath, outPath] = process.argv.slice(2);
const files = JSON.parse(readFileSync(filesPath, "utf-8"));
const pkgDir = join(root, pkg);

// The package's own vitest: apps/web-ui installs its own, and the root one runs
// its tests without its jsdom setup.
const vitestNode = createRequire(join(pkgDir, "package.json")).resolve(
  "vitest/node",
);
const { createVitest } = await import(pathToFileURL(vitestNode).href);

const reportsDirectory = mkdtempSync(join(tmpdir(), "lore-trace-cov-"));
let coverage;
const vitest = await createVitest("test", {
  root: pkgDir,
  watch: false,
  reporters: [
    {
      onCoverage(map) {
        coverage = map;
      },
    },
  ],
  coverage: {
    enabled: true,
    provider: "v8",
    reporter: [],
    include: ["src/**"],
    cleanOnRerun: true,
    reportsDirectory,
    // One file never meets a package's global thresholds (mcp-server's 100%).
    thresholds: { lines: 0, functions: 0, statements: 0, branches: 0 },
  },
});

const results = {};

try {
  await vitest.createCoverageProvider();
  // By module id, not by filter: a filter is a pattern, and web-ui's `[id]`
  // directories read as a character class that matches nothing.
  const specByModule = new Map(
    (await vitest.getRelevantTestSpecifications()).map((spec) => [
      spec.moduleId,
      spec,
    ]),
  );

  for (const file of files) {
    const spec = specByModule.get(join(root, file));

    if (!spec) {
      continue; // not a test of this package's config: left unanswered
    }
    coverage = undefined;
    const run = await vitest.rerunTestSpecifications([spec], false);
    const module = run.testModules.find((m) => m.moduleId === spec.moduleId);

    results[file] = {
      passed:
        module !== undefined && module.ok() && run.unhandledErrors.length === 0,
      covered: coverage ? coveredRanges(coverage.toJSON(), root) : [],
    };
  }
} finally {
  writeFileSync(outPath, JSON.stringify(results));
  await vitest.close();
  rmSync(reportsDirectory, { recursive: true, force: true });
}

// Every file was answered, failing ones included: vitest sets a non-zero exit
// code for a failed test, which run_many would read as this worker crashing.
process.exitCode = 0;
