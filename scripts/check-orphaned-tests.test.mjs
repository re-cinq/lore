import { test } from "node:test";
import assert from "node:assert/strict";
import { findOrphaned } from "./check-orphaned-tests.mjs";

test("findOrphaned returns files not covered by any configured glob", () => {
  const orphaned = findOrphaned(
    ["libs/shared/src/foo.test.ts", "tools/vitest/bar.test.ts"],
    ["libs/shared/**"],
  );
  assert.deepEqual(orphaned, ["tools/vitest/bar.test.ts"]);
});

test("findOrphaned returns empty array when all files are covered", () => {
  const orphaned = findOrphaned(
    ["scripts/check-bootstrap-columns.test.mjs", "apps/web-ui/src/foo.test.ts"],
    ["scripts/**/*.test.mjs", "apps/web-ui/**"],
  );
  assert.deepEqual(orphaned, []);
});

test("findOrphaned matches a specific file path exactly", () => {
  const orphaned = findOrphaned(
    ["tools/vitest/workspace-source.test.ts", "tools/vitest/other.test.ts"],
    ["tools/vitest/workspace-source.test.ts"],
  );
  assert.deepEqual(orphaned, ["tools/vitest/other.test.ts"]);
});
