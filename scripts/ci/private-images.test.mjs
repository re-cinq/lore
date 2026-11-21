import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
