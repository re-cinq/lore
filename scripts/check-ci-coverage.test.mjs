import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Guard: every package that declares a vitest.config.ts must appear in the
// pr-checks.yml test matrix. A vitest config with no CI job means the suite
// runs locally but never on a PR — a regression there is invisible to reviewers.
// specs/testing-standards/spec.md requirement 3: "Attributable CI — each
// subproject's suite runs as its own CI job."

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function vitestPackages(root) {
  const found = [];
  for (const base of ["apps", "libs"]) {
    const baseDir = join(root, base);
    let entries;
    try {
      entries = readdirSync(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgDir = join(baseDir, entry.name);
      if (!existsSync(join(pkgDir, "vitest.config.ts"))) continue;
      const pkgJsonPath = join(pkgDir, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      found.push({ relDir: `${base}/${entry.name}`, pkgName: pkg.name });
    }
  }
  return found;
}

test("every package with a vitest.config.ts has a CI job in pr-checks.yml", () => {
  const workflow = readFileSync(
    join(ROOT, ".github/workflows/pr-checks.yml"),
    "utf8",
  );
  const suites = vitestPackages(ROOT);
  const uncovered = suites
    .filter(
      ({ relDir, pkgName }) =>
        !workflow.includes(pkgName) && !workflow.includes(relDir),
    )
    .map(({ relDir, pkgName }) => `${relDir} (${pkgName})`);

  assert.deepEqual(
    uncovered,
    [],
    "each entry is a test suite with no CI job — add it to the pr-checks.yml matrix",
  );
});
