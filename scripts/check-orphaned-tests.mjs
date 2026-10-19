#!/usr/bin/env node
// Fails if any *.test.* or *.spec.* file in the repo is not matched by a
// configured runner in pr-checks.yml or migrations.yml.
// Three test suites went unrun because CI had no entry for them — this guard
// would have caught each at creation time.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".lore-pgdata",
  ".cache",
  "coverage",
]);

/** Finds all *.test.* and *.spec.* files under `root` (relative to repoRoot). */
export function findTestFiles(root) {
  const results = [];
  const absRoot = join(repoRoot, root);

  const walk = (absDir) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(join(absDir, entry.name));
        }
      } else if (/\.(?:test|spec)\.[a-z]+$/.test(entry.name)) {
        results.push(
          relative(repoRoot, join(absDir, entry.name)).replace(/\\/g, "/"),
        );
      }
    }
  };

  walk(absRoot);
  return results;
}

/** Returns true when `filePath` matches the glob.
 *  Supports: `dir/**`, `dir/**\/*.ext`, and exact paths. */
function matchesGlob(filePath, glob) {
  if (glob.endsWith("/**")) {
    const prefix = glob.slice(0, -3);
    return filePath === prefix || filePath.startsWith(prefix + "/");
  }
  const wildcardIdx = glob.indexOf("/**/*.");
  if (wildcardIdx !== -1) {
    const dir = glob.slice(0, wildcardIdx);
    const ext = glob.slice(wildcardIdx + 6);
    return filePath.startsWith(dir + "/") && filePath.endsWith("." + ext);
  }
  return filePath === glob;
}

/** Returns the subset of `testFiles` not matched by any glob in `coveredGlobs`. */
export function findOrphaned(testFiles, coveredGlobs) {
  return testFiles.filter((f) => !coveredGlobs.some((g) => matchesGlob(f, g)));
}

/** Maps workspace package names to their directory paths. */
function buildWorkspaceDirMap() {
  const map = new Map();
  for (const wsRoot of ["libs", "apps"]) {
    let entries;
    try {
      entries = readdirSync(join(repoRoot, wsRoot), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const pkg = JSON.parse(
          readFileSync(
            join(repoRoot, wsRoot, entry.name, "package.json"),
            "utf8",
          ),
        );
        if (pkg.name) map.set(pkg.name, `${wsRoot}/${entry.name}`);
      } catch {
        // no package.json — skip
      }
    }
  }
  return map;
}

/** Extracts covered globs from a workflow YAML string.
 *  Parses the patterns the repo's CI actually uses; no YAML library needed. */
function parseWorkflowGlobs(yaml, workspaceDirMap) {
  const globs = new Set();

  // npm test -w <pkg> or npm run test:coverage -w <pkg>
  for (const m of yaml.matchAll(
    /npm (?:run )?(?:test|test:\S+)\s+-w\s+(\S+)/g,
  )) {
    const dir = workspaceDirMap.get(m[1]);
    if (dir) globs.add(`${dir}/**`);
  }

  // npm run test:coverage --prefix <dir> (web-ui)
  for (const m of yaml.matchAll(
    /npm run (?:test|test:\S+)\s+--prefix\s+(\S+)/g,
  )) {
    globs.add(`${m[1]}/**`);
  }

  // find scripts -name '*.test.mjs'
  if (yaml.includes("find scripts") && yaml.includes("*.test.mjs")) {
    globs.add("scripts/**/*.test.mjs");
  }

  // node --test <specific-file>
  for (const m of yaml.matchAll(/node --test\s+(\S+)/g)) {
    globs.add(m[1]);
  }

  // npx vitest run <specific-file> (no --config / bare file path)
  for (const m of yaml.matchAll(
    /npx vitest run\s+([\w./\-]+\.(?:test|spec)\.\S+)/g,
  )) {
    globs.add(m[1]);
  }

  return globs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirMap = buildWorkspaceDirMap();

  const allGlobs = new Set();
  for (const name of ["pr-checks.yml", "migrations.yml"]) {
    let yaml;
    try {
      yaml = readFileSync(join(repoRoot, ".github/workflows", name), "utf8");
    } catch {
      continue;
    }
    for (const g of parseWorkflowGlobs(yaml, dirMap)) allGlobs.add(g);
  }

  const testFiles = findTestFiles(".");
  const orphaned = findOrphaned(testFiles, [...allGlobs]);

  if (orphaned.length > 0) {
    console.error(
      "[lore] orphaned test files — no CI runner is configured for them:\n",
    );
    for (const f of orphaned) console.error(`  ${f}`);
    console.error(
      "\nAdd each to a runner in .github/workflows/pr-checks.yml or migrations.yml.",
    );
    process.exit(1);
  }

  console.log(
    `[lore] all ${testFiles.length} test file(s) have a configured CI runner.`,
  );
}
