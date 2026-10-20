import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const SHARED_BUILD = ".github/workflows/_build-image.yml";
const CHARTS = "infra/terraform/modules/gke-mcp/lore-platform";

const SERVICE_WORKFLOWS = [
  ".github/workflows/build-lore-api.yml",
  ".github/workflows/build-mcp-server.yml",
  ".github/workflows/build-stations.yml",
  ".github/workflows/build-ui.yml",
];

const IMAGE_WORKFLOWS = [
  ...SERVICE_WORKFLOWS,
  ".github/workflows/build-agent-image.yml",
];

const NODE_DOCKERFILES = [
  "apps/mcp-server/Dockerfile",
  "apps/stations/Dockerfile",
  "apps/web-ui/Dockerfile",
];

const read = (path) => readFileSync(path, "utf-8");
const workflow = (path) => parse(read(path));
const sharedBuild = workflow(SHARED_BUILD);
const sharedBuildText = read(SHARED_BUILD);

function stepsOf(job) {
  return sharedBuild.jobs[job].steps;
}

function stepUsing(job, action) {
  return stepsOf(job).filter((step) =>
    String(step.uses ?? "").startsWith(action),
  );
}

test("the shared build runs amd64 on ubuntu-latest and arm64 on the native arm runner on main, and amd64 alone elsewhere", () => {
  const include = sharedBuild.jobs.build.strategy.matrix.include;

  assert.match(include, /github\.ref == 'refs\/heads\/main'/);
  assert.match(
    include,
    /"platform":"linux\/amd64","runner":"ubuntu-latest".*"platform":"linux\/arm64","runner":"ubuntu-24\.04-arm".*\|\| '\[\{"platform":"linux\/amd64","runner":"ubuntu-latest"[^\]]*\]'/,
  );
  assert.equal(sharedBuild.jobs.build["runs-on"], "${{ matrix.runner }}");
});

test("each matrix leg and the merge job set up buildx and no job sets up qemu", () => {
  assert.equal(stepUsing("build", "docker/setup-buildx-action").length, 1);
  assert.equal(stepUsing("merge", "docker/setup-buildx-action").length, 1);
  assert.doesNotMatch(sharedBuildText, /setup-qemu-action/);
});

test("main pushes each leg by digest under the image name and other refs build without pushing", () => {
  const stepNamed = (name) =>
    stepsOf("build").find((step) => step.name === name);
  const pushByDigest = stepNamed("Build and push by digest");
  const buildOnly = stepNamed("Build (no push)");

  assert.deepEqual(
    { if: pushByDigest.if, outputs: pushByDigest.with.outputs },
    {
      if: "github.ref == 'refs/heads/main'",
      outputs:
        "type=image,name=${{ env.REGISTRY }}/${{ inputs.image_name }},push-by-digest=true,name-canonical=true,push=true",
    },
  );
  assert.deepEqual(
    { if: buildOnly.if, push: buildOnly.with.push },
    { if: "github.ref != 'refs/heads/main'", push: false },
  );
});

test("the merge job runs on main only, creates the manifest index and fails unless it lists linux/amd64 and linux/arm64", () => {
  const merge = sharedBuild.jobs.merge;
  const run = merge.steps.map((step) => step.run ?? "").join("\n");

  assert.equal(merge.if, "github.ref == 'refs/heads/main'");
  assert.deepEqual(merge.needs, "build");
  assert.match(run, /docker buildx imagetools create/);
  assert.match(run, /\{\{\.Platform\.OS\}\}\/\{\{\.Platform\.Architecture\}\}/);
  assert.match(run, /grep -qx linux\/amd64/);
  assert.match(run, /grep -qx linux\/arm64/);
});

test("the shared build is a workflow_call taking image name, dockerfile, context and build args and returning the merge job's image_tag", () => {
  const call = sharedBuild.on.workflow_call;

  assert.deepEqual(
    Object.keys(call.inputs).filter((name) => name !== "smoke_command"),
    ["image_name", "dockerfile", "context", "build_args"],
  );
  assert.equal(
    call.outputs.image_tag.value,
    "${{ jobs.merge.outputs.image_tag }}",
  );
});

test("all five image workflows build through the shared build with packages: write", () => {
  for (const path of IMAGE_WORKFLOWS) {
    const build = workflow(path).jobs.build;

    assert.deepEqual(
      { uses: build.uses, packages: build.permissions.packages },
      { uses: "./.github/workflows/_build-image.yml", packages: "write" },
      path,
    );
  }
});

test("every service deploy job needs the build and pins the image_tag it returns", () => {
  for (const path of SERVICE_WORKFLOWS) {
    const deploy = workflow(path).jobs.deploy;
    const run = deploy.steps.map((step) => step.run ?? "").join("\n");

    assert.ok([deploy.needs].flat().includes("build"), path);
    assert.match(run, /needs\.build\.outputs\.image_tag/, path);
  }
});

test("every workflow that calls the shared build lists it in its push and pull_request path filters", () => {
  for (const path of IMAGE_WORKFLOWS) {
    const triggers = workflow(path).on;

    for (const event of ["push", "pull_request"]) {
      const paths = triggers[event]?.paths;

      if (paths) {
        assert.ok(paths.includes(SHARED_BUILD), `${path} ${event}`);
      }
    }
  }

  assert.match(
    read(".github/workflows/build-ui.yml"),
    /\\\.github\/workflows\/\(build-ui\|_build-image\)\\\.yml\$/,
  );
});

test("the agent image runs its tool smoke test inside the built image on every leg before the push", () => {
  const agent = workflow(".github/workflows/build-agent-image.yml").jobs.build;
  const names = stepsOf("build").map((step) => step.name);

  assert.match(agent.with.smoke_command, /jq --version.*java -version/s);
  assert.ok(
    names.indexOf("Smoke test") < names.indexOf("Build and push by digest"),
  );
});

test("the agent image picks its yq checksum by target architecture", () => {
  const dockerfile = read("apps/agent-image/Dockerfile");

  assert.match(dockerfile, /amd64\) yq_sha256="\$\{YQ_SHA256_AMD64\}"/);
  assert.match(dockerfile, /arm64\) yq_sha256="\$\{YQ_SHA256_ARM64\}"/);
});

test("lore-api's Go stage runs on the build platform and cross-compiles lore-code-trace for linux and darwin on amd64 and arm64", () => {
  const dockerfile = read("apps/lore-api/Dockerfile");

  assert.match(
    dockerfile,
    /^FROM --platform=\$BUILDPLATFORM golang:\S+ AS gobuilder$/m,
  );
  assert.match(
    dockerfile,
    /for t in linux-amd64 linux-arm64 darwin-amd64 darwin-arm64/,
  );
});

test("the node Dockerfiles build from node:22-slim with install scripts off and pin no platform", () => {
  for (const path of NODE_DOCKERFILES) {
    const dockerfile = read(path);

    assert.match(dockerfile, /^FROM node:22-slim/m, path);
    assert.match(dockerfile, /npm ci --ignore-scripts/, path);
    assert.doesNotMatch(dockerfile, /--platform/, path);
  }
});

test("the post-deploy smoke jobs run after the deploy against the deployed lore-api and ui URLs", () => {
  const api = workflow(".github/workflows/build-lore-api.yml").jobs.smoke;
  const ui = workflow(".github/workflows/build-ui.yml").jobs.smoke;

  assert.deepEqual([api.needs, ui.needs], ["deploy", ["build", "deploy"]]);
  assert.match(JSON.stringify(api.steps), /LORE_API_URL/);
  assert.match(JSON.stringify(ui.steps), /LORE_UI_URL/);
});

test("the local-dev compose stack runs pgvector/pgvector:pg16 and dgraph/standalone:v24.0.0", () => {
  const services = parse(read("infra/compose.yaml")).services;

  assert.deepEqual(
    Object.values(services).map((service) => service.image),
    ["pgvector/pgvector:pg16", "dgraph/standalone:v24.0.0"],
  );
});

test("no lore-platform chart pins a node architecture", () => {
  const grep = spawnSync(
    "git",
    ["grep", "-lE", String.raw`kubernetes\.io/arch|amd64|arm64`, "--", CHARTS],
    { encoding: "utf-8" },
  );

  assert.deepEqual(
    { status: grep.status, files: grep.stdout },
    { status: 1, files: "" },
  );
});

test("the GKE node pools stay on x86 n2 machines", () => {
  const machineTypes = [
    ...read("infra/terraform/modules/gke-mcp/main.tf").matchAll(
      /machine_type\s*=\s*"([^"]+)"/g,
    ),
  ].map(([, type]) => type);

  assert.deepEqual(machineTypes, ["n2-standard-4", "n2-standard-2"]);
});
