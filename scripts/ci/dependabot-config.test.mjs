import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const config = parse(readFileSync(".github/dependabot.yml", "utf-8"));
const updateFor = (directory) =>
  config.updates.find((update) => update.directory === directory);

test("the root workspaces move every OpenTelemetry package together, majors included, in a group of its own", () => {
  assert.deepEqual(updateFor("/").groups.opentelemetry, {
    patterns: ["@opentelemetry/*"],
  });
});

test("the root workspaces move the team's own @re-cinq packages in a group of their own", () => {
  assert.deepEqual(updateFor("/").groups["re-cinq"], {
    patterns: ["@re-cinq/*"],
  });
});

test("the root minor-and-patch group leaves out the OpenTelemetry and @re-cinq packages", () => {
  assert.deepEqual(
    updateFor("/").groups["workspaces-minor-and-patch"]["exclude-patterns"],
    ["@opentelemetry/*", "@re-cinq/*"],
  );
});

test("both directories keep @types/node on the Node major Lore runs on", () => {
  for (const directory of ["/", "/apps/web-ui"]) {
    assert.deepEqual(
      updateFor(directory).ignore[0],
      {
        "dependency-name": "@types/node",
        "update-types": ["version-update:semver-major"],
      },
      directory,
    );
  }
});

test("the root workspaces hold web-tree-sitter, whose newer releases cannot load the tree-sitter-wasms grammars", () => {
  assert.deepEqual(updateFor("/").ignore.slice(1), [
    { "dependency-name": "web-tree-sitter" },
  ]);
  assert.match(
    readFileSync("libs/shared/package.json", "utf-8"),
    /"web-tree-sitter": "\^0\.24\.\d+"/,
  );
});

test("the web UI ignores nothing but the @types/node majors", () => {
  assert.equal(updateFor("/apps/web-ui").ignore.length, 1);
});

test("Lore runs on Node 22, the line @types/node is held to", () => {
  const { engines } = JSON.parse(readFileSync("package.json", "utf-8"));

  assert.equal(engines.node, ">=22");
  assert.match(
    readFileSync("apps/lore-api/Dockerfile", "utf-8"),
    /^FROM node:22-slim$/m,
  );
});
