#!/usr/bin/env node
// Lore test-command interface -- `related`. Prints, as a JSON array, the
// repo-relative test files the change since {base} affects, so the runner skips
// the rest of the suite; prints null when the change reaches every test. Each
// package answers through vitest's own module graph (`vitest list --changed`),
// which follows `@re-cinq/lore-*` imports into the libs' src, so a libs/shared
// edit also names the dependent tests of every app. A failed package exits
// non-zero, and the runner falls back to every test.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reachesEveryTest } from "../../dist/domain/spec-trace/related-tests.js";
import { PKGS, SCOPE } from "./trace-packages.mjs";

const ROOT = process.cwd(); // manifest cwd == repo root

const base = process.argv[2];

if (!base) {
  console.error("related: missing base commit");
  process.exit(2);
}

function repoRelative(absolutePath) {
  return absolutePath.startsWith(`${ROOT}/`)
    ? absolutePath.slice(ROOT.length + 1)
    : absolutePath;
}

function relatedInPkg(pkg) {
  // JSON goes to a file for the reason list-tests.mjs gives: stdout carries noise.
  const dir = mkdtempSync(join(tmpdir(), "lore-trace-related-"));
  const jsonPath = join(dir, "related.json");

  try {
    execFileSync(
      "npx",
      [
        "vitest",
        "list",
        SCOPE,
        "--changed",
        base,
        "--filesOnly",
        `--json=${jsonPath}`,
      ],
      { cwd: join(ROOT, pkg), stdio: ["ignore", "ignore", "inherit"] },
    );

    return JSON.parse(readFileSync(jsonPath, "utf-8")).map((entry) =>
      repoRelative(entry.file),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const changed = execFileSync(
  "git",
  ["-c", "core.quotePath=false", "diff", "--name-only", `${base}..HEAD`],
  { cwd: ROOT, encoding: "utf-8" },
)
  .split("\n")
  .filter(Boolean);

if (reachesEveryTest(changed)) {
  process.stdout.write("null");
} else {
  process.stdout.write(JSON.stringify(PKGS.flatMap(relatedInPkg)));
}
