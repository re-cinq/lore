import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const config = parse(readFileSync(".github/dependabot.yml", "utf-8"));
const updateFor = (directory) =>
  config.updates.find((update) => update.directory === directory);

test("the root workspaces move every OpenTelemetry package together, majors included, before any other group", () => {
  const [first, ...rest] = Object.entries(updateFor("/").groups);

  assert.deepEqual(first, [
    "opentelemetry",
    { patterns: ["@opentelemetry/*"] },
  ]);
  assert.ok(
    rest.every(([, group]) => !group.patterns?.includes("@opentelemetry/*")),
  );
});

test("both directories keep @types/node on the Node major Lore runs on", () => {
  for (const directory of ["/", "/apps/web-ui"]) {
    assert.deepEqual(
      updateFor(directory).ignore,
      [
        {
          "dependency-name": "@types/node",
          "update-types": ["version-update:semver-major"],
        },
      ],
      directory,
    );
  }
});

test("Lore runs on Node 22, the line @types/node is held to", () => {
  const { engines } = JSON.parse(readFileSync("package.json", "utf-8"));

  assert.equal(engines.node, ">=22");
  assert.match(
    readFileSync("apps/lore-api/Dockerfile", "utf-8"),
    /^FROM node:22-slim$/m,
  );
});
