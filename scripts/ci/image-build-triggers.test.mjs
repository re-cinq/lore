import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const ROOT_PACKAGE_FILES = ["package.json", "package-lock.json"];

const ROOT_WORKSPACE_IMAGES = {
  ".github/workflows/build-lore-api.yml": "apps/lore-api/Dockerfile",
  ".github/workflows/build-mcp-server.yml": "apps/mcp-server/Dockerfile",
  ".github/workflows/build-stations.yml": "apps/stations/Dockerfile",
};

const read = (path) => readFileSync(path, "utf-8");
const triggersOf = (path) => parse(read(path)).on;

test("a change to the root package files alone starts the lore-api, mcp-server and stations image builds on main", () => {
  for (const path of Object.keys(ROOT_WORKSPACE_IMAGES)) {
    const push = triggersOf(path).push;

    assert.deepEqual(push.branches, ["main"], path);

    for (const file of ROOT_PACKAGE_FILES) {
      assert.ok(push.paths.includes(file), `${path} push ${file}`);
    }
  }
});

test("those image workflows that build on pull requests also build for a change to the root package files", () => {
  for (const path of Object.keys(ROOT_WORKSPACE_IMAGES)) {
    const paths = triggersOf(path).pull_request?.paths ?? ROOT_PACKAGE_FILES;

    for (const file of ROOT_PACKAGE_FILES) {
      assert.ok(paths.includes(file), `${path} pull_request ${file}`);
    }
  }
});

test("each of those images installs its dependencies from the root package files", () => {
  for (const dockerfile of Object.values(ROOT_WORKSPACE_IMAGES)) {
    assert.match(
      read(dockerfile),
      /^COPY package\.json package-lock\.json \.\/$/m,
      dockerfile,
    );
  }
});
