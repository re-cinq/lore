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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coveredRanges } from "../../dist/domain/spec-trace/covered-ranges.js";
import { descriptorsFromVitestModules } from "../../dist/domain/spec-trace/trace-descriptors.js";
import { createTraceVitest } from "./trace-vitest.mjs";

const [root, pkg, filesPath, outPath] = process.argv.slice(2);
const files = JSON.parse(readFileSync(filesPath, "utf-8"));
const reportsDirectory = mkdtempSync(join(tmpdir(), "lore-trace-cov-"));
let coverage;
const vitest = await createTraceVitest(root, pkg, {
  directory: reportsDirectory,
  onCoverage(map) {
    coverage = map;
  },
});

const results = {};

try {
  await vitest.createCoverageProvider();
  // By module id, not by filter: a filter is a pattern, and web-ui's `[id]`
  // directories read as a character class that matches nothing.
  const specsByModule = Map.groupBy(
    await vitest.getRelevantTestSpecifications(),
    (spec) => spec.moduleId,
  );

  for (const file of files) {
    const specs = specsByModule.get(join(root, file));

    if (!specs) {
      continue; // not a test of this package's config: left unanswered
    }
    coverage = undefined;
    const run = await vitest.rerunTestSpecifications(specs, false);
    const modules = run.testModules.filter(
      (module) => module.moduleId === join(root, file),
    );

    results[file] = {
      passed:
        modules.length === specs.length &&
        modules.every((module) => module.ok()) &&
        run.unhandledErrors.length === 0,
      covered: coverage ? coveredRanges(coverage.toJSON(), root) : [],
      tests: descriptorsFromVitestModules(modules, {
        pkg,
        executed: true,
        unhandledErrors: run.unhandledErrors,
      }),
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
