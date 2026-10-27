import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { PKGS } from "../libs/shared/scripts/trace/trace-packages.mjs";

const TEST_FILE = /\.test\.tsx?$/;

function packagesWithTests() {
  const tracked = execFileSync("git", ["ls-files", "apps", "libs"], {
    encoding: "utf-8",
  })
    .split("\n")
    .filter(Boolean);

  return [
    ...new Set(
      tracked
        .filter((path) => TEST_FILE.test(path))
        .map((path) => path.split("/").slice(0, 2).join("/")),
    ),
  ].filter((pkg) => existsSync(`${pkg}/vitest.config.ts`));
}

test("every package with vitest tests is in the spec-trace package list", () => {
  const missing = packagesWithTests().filter((pkg) => !PKGS.includes(pkg));

  assert.deepEqual(
    missing,
    [],
    "tests in these packages never reach the traceability graph: add them to libs/shared/scripts/trace/trace-packages.mjs",
  );
});
