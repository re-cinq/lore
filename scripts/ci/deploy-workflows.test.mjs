import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

// Every workflow whose `deploy` job records the freshly built image tag in the
// cluster values through bump-image-tag.sh; Argo CD rolls it out from main.
// The job pushes a commit, so it must be allowed to write contents.
const UMBRELLA_DEPLOY_WORKFLOWS = [
  ".github/workflows/build-mcp-server.yml",
  ".github/workflows/build-lore-api.yml",
  ".github/workflows/build-stations.yml",
  ".github/workflows/build-ui.yml",
];

function deployJob(workflow) {
  const job = parse(readFileSync(workflow, "utf-8")).jobs.deploy;

  assert.ok(job, `${workflow}: has no deploy job`);

  return job;
}

test("every umbrella deploy job records its image tag with bump-image-tag.sh and may push to main", () => {
  for (const workflow of UMBRELLA_DEPLOY_WORKFLOWS) {
    const job = deployJob(workflow);
    const runsTagBump = job.steps.some((step) =>
      String(step.run ?? "").includes("scripts/ci/bump-image-tag.sh"),
    );

    assert.equal(
      runsTagBump,
      true,
      `${workflow}: deploy job never calls bump-image-tag.sh`,
    );
    assert.equal(
      job.permissions.contents,
      "write",
      `${workflow}: deploy job cannot push the tag bump`,
    );
  }
});
