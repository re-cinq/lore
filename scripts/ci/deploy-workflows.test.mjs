import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

// Every workflow whose `deploy` job records the freshly built image tag in the
// cluster values through bump-image-tag.sh; Argo CD rolls it out from main.
// main only takes pull requests, so the job pushes a branch and merges a pull
// request for it: it needs to write contents and pull requests.
const UMBRELLA_DEPLOY_WORKFLOWS = [
  ".github/workflows/build-mcp-server.yml",
  ".github/workflows/build-lore-api.yml",
  ".github/workflows/build-stations.yml",
  ".github/workflows/build-ui.yml",
  ".github/workflows/build-agent-image.yml",
];

function deployJob(workflow) {
  const job = parse(readFileSync(workflow, "utf-8")).jobs.deploy;

  assert.ok(job, `${workflow}: has no deploy job`);

  return job;
}

test("every umbrella deploy job records its image tag with bump-image-tag.sh and may merge a pull request for it", () => {
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
    assert.deepEqual(
      {
        contents: job.permissions.contents,
        pullRequests: job.permissions["pull-requests"],
      },
      { contents: "write", pullRequests: "write" },
      `${workflow}: deploy job cannot merge the tag bump`,
    );
  }
});

function stepRuns(job, text) {
  return job.steps.some((step) => String(step.run ?? "").includes(text));
}

const releaseJobs = parse(
  readFileSync(".github/workflows/release.yml", "utf-8"),
).jobs;

test("the release workflow packages and pushes the lore-install chart with the script, with write access to packages", () => {
  const job = releaseJobs.chart;

  assert.deepEqual(
    {
      packages: job.permissions.packages,
      packagesScript: stepRuns(job, "scripts/ci/package-install-chart.sh"),
      pushes: stepRuns(job, "helm push"),
    },
    { packages: "write", packagesScript: true, pushes: true },
  );
});

test("the release workflow pushes the lore-databases chart next to lore-install", () => {
  assert.equal(
    stepRuns(releaseJobs.chart, 'helm push "dist/lore-databases-${TAG#v}.tgz"'),
    true,
  );
});

test("the GitHub release waits for the lore-install chart push", () => {
  assert.deepEqual(releaseJobs.release.needs, ["images", "chart"]);
});

test("pull requests that change the install chart package it with the release script", () => {
  const workflow = parse(
    readFileSync(".github/workflows/helm-render.yml", "utf-8"),
  );
  const job = workflow.jobs["install-chart-package"];

  assert.deepEqual(
    {
      watchesScript: workflow.on.pull_request.paths.includes(
        "scripts/ci/package-install-chart.sh",
      ),
      runsScript: stepRuns(job, "scripts/ci/package-install-chart.sh v0.0.0"),
    },
    { watchesScript: true, runsScript: true },
  );
});

function stepIndex(job, text) {
  return job.steps.findIndex((step) => String(step.run ?? "").includes(text));
}

test("the release workflow checks the pins on the packaged archive after packaging and before pushing, and not in verify", () => {
  const job = releaseJobs.chart;

  assert.deepEqual(
    {
      verifyChecksPins: stepRuns(releaseJobs.verify, "check-install-pins.sh"),
      packagesBeforeCheck:
        stepIndex(job, "package-install-chart.sh") <
        stepIndex(job, "check-install-pins.sh"),
      checksBeforePush:
        stepIndex(job, "check-install-pins.sh") < stepIndex(job, "helm push"),
    },
    {
      verifyChecksPins: false,
      packagesBeforeCheck: true,
      checksBeforePush: true,
    },
  );
});

test("the release job appends to a release that exists, creates one otherwise and keeps --verify-tag", () => {
  const script = releaseJobs.release.steps
    .map((step) => String(step.run ?? ""))
    .join("\n");

  assert.deepEqual(
    {
      looksForRelease: script.includes('gh release view "$TAG"'),
      editsIt: script.includes('gh release edit "$TAG" --notes-file'),
      createsIt: script.includes('gh release create "$TAG"'),
      verifiesTag: script.includes("--verify-tag"),
    },
    {
      looksForRelease: true,
      editsIt: true,
      createsIt: true,
      verifiesTag: true,
    },
  );
});

test("pull requests that change the install chart check the pins of the v0.0.0 archive they package", () => {
  const job = parse(readFileSync(".github/workflows/helm-render.yml", "utf-8"))
    .jobs["install-chart-package"];

  assert.equal(stepRuns(job, "check-install-pins.sh v0.0.0 "), true);
});
