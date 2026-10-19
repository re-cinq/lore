import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

test("reports a stranded doc comment using lore/no-stranded-doc-comment", () => {
  const dir = mkdtempSync(join(tmpdir(), "stranded-"));
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

  let output = "";
  let status = 0;

  try {
    output = execFileSync(
      "npx",
      ["eslint", "--no-ignore", "-f", "json", filePath],
      {
        cwd: repoRoot,
        encoding: "utf-8",
      },
    );
  } catch (error) {
    status = error.status;
    output = error.stdout || error.message;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.notEqual(status, 0, "ESLint should fail");

  let reports;

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
