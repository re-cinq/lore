import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLayersConfig } from "./layers-config.mjs";

const VALID = {
  layers: {
    "apps/floor": { kernel: [], jobs: ["kernel"] },
    "apps/web-ui": { lib: [] },
  },
  aliases: { "apps/web-ui": { "@/": "" } },
};

test("accepts a well-formed document", () => {
  assert.deepEqual(validateLayersConfig(VALID), VALID);
});

test("accepts an entry written as imports plus tests", () => {
  const doc = {
    layers: {
      "apps/lore-api": { api: { imports: ["http"], tests: ["server"] } },
    },
  };

  assert.deepEqual(validateLayersConfig(doc), doc);
});

test("rejects a package block indented under aliases instead of layers", () => {
  const doc = {
    layers: { "apps/floor": { kernel: [] } },
    aliases: { "libs/shared": { lib: [], models: ["lib"] } },
  };

  assert.throws(
    () => validateLayersConfig(doc),
    /aliases\.libs\/shared.*alias map and never checked/s,
  );
});

test("rejects an alias for a package that has no layers entry", () => {
  const doc = {
    layers: { "apps/floor": { kernel: [] } },
    aliases: { "apps/web-ui": { "@/": "" } },
  };

  assert.throws(() => validateLayersConfig(doc), /no `layers` entry/);
});

test("rejects an unknown top-level key", () => {
  assert.throws(
    () => validateLayersConfig({ layers: {}, layer: {} }),
    /unknown top-level key/,
  );
});

test("rejects an entry that is neither a list nor imports/tests", () => {
  assert.throws(
    () => validateLayersConfig({ layers: { "apps/floor": { kernel: "lib" } } }),
    /must be a list, or a mapping/,
  );
});

test("rejects an unknown key inside an entry", () => {
  assert.throws(
    () =>
      validateLayersConfig({
        layers: { "apps/floor": { kernel: { imports: [], test: [] } } },
      }),
    /unknown key\(s\) test/,
  );
});

test("rejects a non-list imports", () => {
  assert.throws(
    () =>
      validateLayersConfig({
        layers: { "apps/floor": { kernel: { imports: "lib" } } },
      }),
    /imports must be a list/,
  );
});
