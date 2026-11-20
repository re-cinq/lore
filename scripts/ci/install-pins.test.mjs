import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const REPO = resolve(import.meta.dirname, "../..");
const COMMITTED_VALUES = join(REPO, "deploy/install/values.yaml");

function run(script, args, cwd = REPO) {
  const result = spawnSync("bash", [join(REPO, script), ...args], {
    cwd,
    encoding: "utf-8",
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function scratch() {
  return mkdtempSync(join(tmpdir(), "install-pins-"));
}

function stampedValues(version) {
  const values = join(scratch(), "values.yaml");

  writeFileSync(values, readFileSync(COMMITTED_VALUES));
  assert.equal(
    run("scripts/ci/stamp-image-tags.sh", [values, version]).status,
    0,
  );

  return values;
}

function archiveOf(valuesFile) {
  const directory = scratch();

  mkdirSync(join(directory, "lore-install"));
  writeFileSync(
    join(directory, "lore-install/values.yaml"),
    readFileSync(valuesFile),
  );
  const archive = join(directory, "lore-install.tgz");
  const packed = spawnSync("tar", [
    "czf",
    archive,
    "-C",
    directory,
    "lore-install",
  ]);

  assert.equal(packed.status, 0);

  return archive;
}

function imageTags(valuesFile) {
  const platform = parse(readFileSync(valuesFile, "utf-8"))["lore-platform"];

  return {
    api: platform["lore-api"].image.tag,
    mcp: platform["lore-mcp-gateway"].image.tag,
    ui: platform["lore-ui"].image.tag,
    stations: platform["lore-stations"].image.tag,
    agent: platform["lore-api"].floor.agentImage,
  };
}

test("stamping v9.8.7 sets the four image tags and the agent image to v9.8.7", () => {
  assert.deepEqual(imageTags(stampedValues("v9.8.7")), {
    api: "v9.8.7",
    mcp: "v9.8.7",
    ui: "v9.8.7",
    stations: "v9.8.7",
    agent: "ghcr.io/re-cinq/lore-agent:v9.8.7",
  });
});

test("stamping v9.8.7 twice leaves the same values as once", () => {
  const values = stampedValues("v9.8.7");
  const once = parse(readFileSync(values, "utf-8"));

  run("scripts/ci/stamp-image-tags.sh", [values, "v9.8.7"]);

  assert.deepEqual(parse(readFileSync(values, "utf-8")), once);
});

test("stamping refuses a version that is not vMAJOR.MINOR.PATCH", () => {
  const values = join(scratch(), "values.yaml");

  writeFileSync(values, readFileSync(COMMITTED_VALUES));

  assert.deepEqual(run("scripts/ci/stamp-image-tags.sh", [values, "1.2.3"]), {
    status: 1,
    output: "[lore] '1.2.3' is not vMAJOR.MINOR.PATCH\n",
  });
});

test("the pin check passes on an archive stamped v9.8.7 for v9.8.7, with no checkout around it", () => {
  const archive = archiveOf(stampedValues("v9.8.7"));

  assert.deepEqual(
    run("scripts/ci/check-install-pins.sh", ["v9.8.7", archive], scratch()),
    {
      status: 0,
      output: `[lore] ${archive} pins every image to v9.8.7\n`,
    },
  );
});

test("the pin check fails on an archive stamped v9.8.6 for v9.8.7, naming all five images", () => {
  const archive = archiveOf(stampedValues("v9.8.6"));
  const { status, output } = run("scripts/ci/check-install-pins.sh", [
    "v9.8.7",
    archive,
  ]);

  assert.deepEqual(
    {
      status,
      names: output.match(
        /lore-(api|mcp|ui|stations|agent) is pinned to 'v9.8.6', not v9.8.7/g,
      )?.length,
    },
    { status: 1, names: 5 },
  );
});

test("the pin check fails when only the agent image is stamped with another version", () => {
  const values = stampedValues("v9.8.7");

  writeFileSync(
    values,
    readFileSync(values, "utf-8").replace(
      "lore-agent:v9.8.7",
      "lore-agent:v9.8.6",
    ),
  );

  assert.deepEqual(
    run("scripts/ci/check-install-pins.sh", ["v9.8.7", archiveOf(values)]),
    {
      status: 1,
      output: "[lore] lore-agent is pinned to 'v9.8.6', not v9.8.7\n",
    },
  );
});

test("the pin check passes when the agent image carries a digest after its v9.8.7 tag", () => {
  const values = stampedValues("v9.8.7");

  writeFileSync(
    values,
    readFileSync(values, "utf-8").replace(
      "lore-agent:v9.8.7",
      `lore-agent:v9.8.7@sha256:${"a".repeat(64)}`,
    ),
  );
  const archive = archiveOf(values);

  assert.equal(
    run("scripts/ci/check-install-pins.sh", ["v9.8.7", archive]).status,
    0,
  );
});

test("the pin check fails on an archive that is not a file", () => {
  assert.deepEqual(
    run("scripts/ci/check-install-pins.sh", ["v9.8.7", "/nonexistent.tgz"]),
    { status: 1, output: "[lore] /nonexistent.tgz is not a file\n" },
  );
});

test("the packaging script stamps the staged values before it packages them", () => {
  const script = readFileSync(
    join(REPO, "scripts/ci/package-install-chart.sh"),
    "utf-8",
  );

  assert.ok(
    script.indexOf(
      'stamp-image-tags.sh "$STAGE/deploy/install/values.yaml" "$TAG"',
    ) < script.indexOf("helm package"),
  );
});
