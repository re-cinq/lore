import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

// Every workflow whose `deploy` job upgrades the umbrella release through
// deploy-lore-platform.sh. A failed deploy there leaves the service on its
// previous image while main carries the new code; the script's only trace
// outside the Actions tab is the `deploy-failed` issue report-deploy-failure.sh
// files, which needs the job to be allowed to write issues (#1650).
const UMBRELLA_DEPLOY_WORKFLOWS = [
  ".github/workflows/build-floor.yml",
  ".github/workflows/build-mcp-server.yml",
  ".github/workflows/build-lore-api.yml",
  ".github/workflows/build-event-router.yml",
  ".github/workflows/build-stations.yml",
  ".github/workflows/build-cluster-agent.yml",
  ".github/workflows/build-ui.yml",
];

function deployJob(workflow) {
  const job = parse(readFileSync(workflow, "utf-8")).jobs.deploy;

  assert.ok(job, `${workflow}: has no deploy job`);

  return job;
}

test("every umbrella deploy job runs deploy-lore-platform.sh with issues: write and GH_TOKEN, so a failed deploy can file its deploy-failed issue", () => {
  for (const workflow of UMBRELLA_DEPLOY_WORKFLOWS) {
    const job = deployJob(workflow);
    const runsDeployScript = job.steps.some((step) =>
      String(step.run ?? "").includes("scripts/ci/deploy-lore-platform.sh"),
    );

    assert.equal(
      runsDeployScript,
      true,
      `${workflow}: deploy job never calls deploy-lore-platform.sh`,
    );
    assert.equal(
      job.permissions.issues,
      "write",
      `${workflow}: deploy job cannot write issues`,
    );
    assert.equal(
      job.env.GH_TOKEN,
      "${{ github.token }}",
      `${workflow}: deploy job has no GH_TOKEN for gh`,
    );
  }
});
