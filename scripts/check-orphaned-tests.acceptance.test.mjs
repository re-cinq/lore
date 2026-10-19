import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

test("check-orphaned-tests.mjs passes because all test files are matched by a configured runner", () => {
  try {
    execFileSync("node", ["scripts/check-orphaned-tests.mjs"], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (err) {
    if (
      err.code === "ENOENT" ||
      (err.message && err.message.includes("Cannot find module"))
    ) {
      assert.fail(
        "Behaviour absent: scripts/check-orphaned-tests.mjs does not exist yet. Claim: Three test suites went unrun this week because no CI job was configured for them",
      );
    }

    const output = (err.stdout || "") + (err.stderr || "");

    assert.fail(
      `The check failed, meaning there are still orphaned tests or it crashed:\n${output}`,
    );
  }
});

test("the check is wired up in github workflows", () => {
  const workflowsDir = join(".github", "workflows");
  const files = readdirSync(workflowsDir);

  let wiredUp = false;

  for (const file of files) {
    if (file.endsWith(".yml") || file.endsWith(".yaml")) {
      const content = readFileSync(join(workflowsDir, file), "utf8");

      if (content.includes("scripts/check-orphaned-tests.mjs")) {
        wiredUp = true;
        break;
      }
    }
  }

  assert.ok(
    wiredUp,
    "Expected scripts/check-orphaned-tests.mjs to be run in a GitHub Actions workflow",
  );
});
