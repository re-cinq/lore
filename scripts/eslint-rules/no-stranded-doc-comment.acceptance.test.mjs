import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

function runEslint(filePath) {
  let output = "";
  let status = 0;

  try {
    output = execFileSync(
      "npx",
      // ESLint 10 starts config lookup from the linted file, not CWD; --config pins it.
      [
        "eslint",
        "--no-ignore",
        "--config",
        "eslint.config.mjs",
        "-f",
        "json",
        filePath,
      ],
      { cwd: repoRoot, encoding: "utf-8" },
    );
  } catch (error) {
    status = error.status;
    output = error.stdout || error.message;
  }

  return { status, output };
}

test("reports a stranded doc comment using lore/no-stranded-doc-comment", () => {
  // ESLint 10 refuses to lint files outside the config file's base path.
  // Create fixtures inside the repo so ESLint processes them normally.
  const dir = mkdtempSync(join(__dirname, "fixture-"));
  const filePath = join(dir, "fixture.ts");

  writeFileSync(
    filePath,
    `
/** This describes nothing now */
/** One node per row within its layer. */
function placeNodes() {}

export function layoutAssemblyLine() {}
  `,
  );

  let reports;
  const { status, output } = runEslint(filePath);

  rmSync(dir, { recursive: true, force: true });

  assert.notEqual(status, 0, "ESLint should fail");

  try {
    reports = JSON.parse(output);
  } catch (e) {
    assert.fail(
      "ESLint failed to run or output invalid JSON. Output: " + output,
    );
  }

  const messages = reports[0]?.messages || [];
  const ruleIds = messages.map((m) => m.ruleId);

  assert.ok(
    ruleIds.includes("lore/no-stranded-doc-comment"),
    "Expected lore/no-stranded-doc-comment to be reported, but found: " +
      JSON.stringify(ruleIds),
  );
});

// specs/no-stranded-doc-comment#2
test("does not flag a module-level doc comment when the next doc comment precedes an exported type or interface declaration", () => {
  const dir = mkdtempSync(join(__dirname, "fixture-nofire-"));
  const filePath = join(dir, "fixture.ts");

  writeFileSync(
    filePath,
    `/** Module-level description of this port. */

/** Named kind for a thread. */
export type ThreadKind = "line" | "task" | "args";

/** Provides a lookup value. */
export interface Port {
  value: string;
}
`,
  );

  const { status, output } = runEslint(filePath);

  rmSync(dir, { recursive: true, force: true });

  let reports;

  try {
    reports = JSON.parse(output);
  } catch (e) {
    assert.fail(
      "ESLint failed to run or output invalid JSON. Output: " + output,
    );
  }

  const messages = (reports[0]?.messages || []).filter(
    (m) => m.ruleId === "lore/no-stranded-doc-comment",
  );

  assert.equal(
    messages.length,
    0,
    "Expected no lore/no-stranded-doc-comment errors for module-level doc + exported type/interface pair, but got: " +
      JSON.stringify(messages),
  );
});
