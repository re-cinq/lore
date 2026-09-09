import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A PATH with fake `gh` + `kubectl` that record their argv, so the script runs without a cluster or a token that reaches GitHub. */
function fakeBin({ existingIssue }) {
  const dir = mkdtempSync(join(tmpdir(), "report-deploy-failure-"));
  const log = join(dir, "calls.log");

  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
echo "gh $*" >> "${log}"
case "$1 $2" in
  "issue list") echo '${existingIssue}' ;;
esac
`,
  );
  writeFileSync(
    join(dir, "kubectl"),
    `#!/usr/bin/env bash
echo "kubectl $*" >> "${log}"
echo "ghcr.io/re-cinq/lore-floor:old1234"
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  chmodSync(join(dir, "kubectl"), 0o755);

  return { dir, log };
}

function run(env, { existingIssue = "" } = {}) {
  const { dir, log } = fakeBin({ existingIssue });
  const stdout = execFileSync(
    "bash",
    [
      "scripts/ci/report-deploy-failure.sh",
      "lore-floor",
      "abc1234",
      "lore-floor",
      "lore-floor",
      "helm upgrade failed (not lock contention)",
    ],
    {
      env: { ...env, PATH: `${dir}:${process.env.PATH}` },
      encoding: "utf8",
    },
  );
  let calls = "";

  try {
    calls = readFileSync(log, "utf8");
  } catch {
    calls = "";
  }

  return { stdout, calls };
}

const ci = {
  GH_TOKEN: "t",
  GITHUB_REPOSITORY: "re-cinq/lore",
  GITHUB_RUN_ID: "42",
  GITHUB_SERVER_URL: "https://github.com",
};

test("files a new deploy-failed issue naming the requested tag and the running image when none is open", () => {
  const { calls } = run(ci, { existingIssue: "" });

  assert.match(
    calls,
    /gh issue create --repo re-cinq\/lore --title Deploy failed: lore-floor is running an older image than main --label deploy-failed --body/,
  );
  assert.match(calls, /ghcr\.io\/re-cinq\/lore-floor:old1234/);
  assert.match(calls, /requested tag \| `abc1234`/);
  assert.match(
    calls,
    /gh issue list --repo re-cinq\/lore --state open --label deploy-failed --search "Deploy failed: lore-floor is running an older image than main" in:title/,
  );
  assert.match(
    calls,
    /https:\/\/github\.com\/re-cinq\/lore\/actions\/runs\/42/,
  );
  assert.doesNotMatch(calls, /gh issue comment/);
});

test("comments on the open deploy-failed issue #17 instead of filing a second one", () => {
  const { calls } = run(ci, { existingIssue: "17" });

  assert.match(calls, /gh issue comment 17 --repo re-cinq\/lore --body/);
  assert.doesNotMatch(calls, /gh issue create/);
});

test("without GH_TOKEN it explains and touches neither gh nor the cluster", () => {
  const { stdout, calls } = run({ GITHUB_REPOSITORY: "re-cinq/lore" });

  assert.match(stdout, /GH_TOKEN\/GITHUB_REPOSITORY unset/);
  assert.equal(calls, "");
});
