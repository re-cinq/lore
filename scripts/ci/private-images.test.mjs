import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const REPO = resolve(import.meta.dirname, "../..");
const read = (path) => parse(readFileSync(resolve(REPO, path), "utf-8"));

function imageNameOf(file) {
  const { jobs } = read(`.github/workflows/${file}`);

  return Object.values(jobs).find((job) => job.with?.image_name)?.with
    .image_name;
}

test("builds the four service images under their private names", () => {
  const built = Object.fromEntries(
    [
      "build-lore-api.yml",
      "build-mcp-server.yml",
      "build-stations.yml",
      "build-ui.yml",
    ].map((file) => [file, imageNameOf(file)]),
  );

  assert.deepEqual(built, {
    "build-lore-api.yml": "re-cinq/lore-security-api",
    "build-mcp-server.yml": "re-cinq/lore-security-mcp",
    "build-stations.yml": "re-cinq/lore-security-stations",
    "build-ui.yml": "re-cinq/lore-security-ui",
  });
});

// The agent image holds the CLIs an agent pod runs, none of this repository's
// source; a private one would also need a pull secret wherever the floor runs agent pods.
test("keeps building the agent image under its public name", () => {
  assert.equal(imageNameOf("build-agent-image.yml"), "re-cinq/lore-agent");
});

test("runs the private service images on the internal cluster", () => {
  const values = read("deploy/clusters/internal-cluster.values.yaml");
  const images = {
    "lore-api": values["lore-api"].image.repository,
    "lore-mcp-gateway": values["lore-mcp-gateway"].image.repository,
    "lore-ui": values["lore-ui"].image.repository,
    "lore-stations": values["lore-stations"].image.repository,
  };

  assert.deepEqual(images, {
    "lore-api": "ghcr.io/re-cinq/lore-security-api",
    "lore-mcp-gateway": "ghcr.io/re-cinq/lore-security-mcp",
    "lore-ui": "ghcr.io/re-cinq/lore-security-ui",
    "lore-stations": "ghcr.io/re-cinq/lore-security-stations",
  });
});

// The registry is the one thing the release script talks to, so it runs
// against a docker that knows the images the cluster values name and records
// every copy it is asked to make.
function releaseAgainst(registry) {
  const dir = mkdtempSync(join(tmpdir(), "release-images-"));
  const copies = join(dir, "copies.log");

  writeFileSync(
    join(dir, "docker"),
    `#!/usr/bin/env bash
case "$3" in
  inspect) digest=$(awk -v ref="$4" '$1 == ref { print $2 }' "${join(dir, "registry")}")
           [ -n "$digest" ] && echo "$digest" || exit 1 ;;
  create) echo "$5 <- $6" >> "${copies}" ;;
esac
`,
  );
  chmodSync(join(dir, "docker"), 0o755);
  writeFileSync(join(dir, "registry"), registry.join("\n"));

  const result = spawnSync(
    "bash",
    [resolve(REPO, "scripts/ci/release-images.sh"), "v1.2.3"],
    {
      cwd: REPO,
      encoding: "utf-8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    },
  );

  return {
    status: result.status,
    copies: readFileSync(copies, "utf-8").trim().split("\n").sort(),
  };
}

test("tags each release on the public image from the build the cluster runs", () => {
  const values = read("deploy/clusters/internal-cluster.values.yaml");
  const agentTag = values["lore-api"].floor.agentImage.split(":").pop();
  const built = [
    ["ghcr.io/re-cinq/lore-security-api", values["lore-api"].image.tag],
    ["ghcr.io/re-cinq/lore-security-mcp", values["lore-mcp-gateway"].image.tag],
    ["ghcr.io/re-cinq/lore-security-ui", values["lore-ui"].image.tag],
    [
      "ghcr.io/re-cinq/lore-security-stations",
      values["lore-stations"].image.tag,
    ],
    ["ghcr.io/re-cinq/lore-agent", agentTag],
  ];

  const release = releaseAgainst(
    built.map(([image, tag], index) => `${image}:${tag} sha256:${index}`),
  );

  assert.deepEqual(release, {
    status: 0,
    copies: [
      "ghcr.io/re-cinq/lore-agent:v1.2.3 <- ghcr.io/re-cinq/lore-agent@sha256:4",
      "ghcr.io/re-cinq/lore-api:v1.2.3 <- ghcr.io/re-cinq/lore-security-api@sha256:0",
      "ghcr.io/re-cinq/lore-mcp:v1.2.3 <- ghcr.io/re-cinq/lore-security-mcp@sha256:1",
      "ghcr.io/re-cinq/lore-stations:v1.2.3 <- ghcr.io/re-cinq/lore-security-stations@sha256:3",
      "ghcr.io/re-cinq/lore-ui:v1.2.3 <- ghcr.io/re-cinq/lore-security-ui@sha256:2",
    ],
  });
});
