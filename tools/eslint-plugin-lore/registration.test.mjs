import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import plugin from "./index.mjs";

/**
 * Lint-as-test for the plugin's own wiring.
 *
 * A rule can stop running in two silent ways: its file exists but nothing
 * exports it from `index.mjs`, or it is exported but no config block turns it
 * on. Neither FAILS anything — a rule that is not registered simply reports
 * nothing, so every check stays green and the only symptom is a finding count
 * that quietly became zero. That is how `no-row-types-outside-models` was
 * deleted from `main` by a stack merge and shipped green (#1439).
 *
 * The three lists must agree: the files on disk, the plugin's exports, and the
 * rules `eslint.config.mjs` switches on.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const files = readdirSync(join(here, "rules"))
  .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
  .map((f) => f.replace(/\.mjs$/, ""))
  .sort();

const exported = Object.keys(plugin.rules).sort();

const config = readFileSync(join(repoRoot, "eslint.config.mjs"), "utf8");
const configured = [
  ...new Set([...config.matchAll(/"lore\/([a-z0-9-]+)"/g)].map((m) => m[1])),
].sort();

test("every rule file is exported from the plugin", () => {
  assert.deepEqual(
    files.filter((f) => !exported.includes(f)),
    [],
  );
});

test("every exported rule has a file behind it", () => {
  assert.deepEqual(
    exported.filter((r) => !files.includes(r)),
    [],
  );
});

test("every exported rule is switched on by eslint.config.mjs", () => {
  assert.deepEqual(
    exported.filter((r) => !configured.includes(r)),
    [],
  );
});

test("eslint.config.mjs names no rule the plugin does not export", () => {
  assert.deepEqual(
    configured.filter((r) => !exported.includes(r)),
    [],
  );
});
