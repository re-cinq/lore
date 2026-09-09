import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import reLint from "@re-cinq/eslint-plugin-re-lint";

/**
 * A rule that is exported but never switched on reports nothing, which looks
 * exactly like clean code. That is how a rule vanished from `main` in a stack
 * merge and shipped green (#1439). The plugin's export list and the rules
 * eslint.config.mjs names must agree in both directions.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(repoRoot, "eslint.config.mjs"), "utf8");

const configured = [
  ...new Set(
    [...config.matchAll(/"re-lint\/([a-z0-9-]+)"/g)].map((match) => match[1]),
  ),
].sort();
const exported = Object.keys(reLint.rules).sort();

test("every re-lint rule is switched on by eslint.config.mjs", () => {
  assert.deepEqual(
    exported.filter((rule) => !configured.includes(rule)),
    [],
  );
});

test("eslint.config.mjs names no rule the plugin does not export", () => {
  assert.deepEqual(
    configured.filter((rule) => !exported.includes(rule)),
    [],
  );
});
