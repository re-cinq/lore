import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLinkIndex,
  corpusExists,
  readSpecFiles,
} from "./spec-link-index.mjs";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "require-spec-link",
);

test("indexes a #Lnn test link as that line", () => {
  const index = buildLinkIndex([
    {
      path: "specs/a/spec.md",
      content: `Works. ([validated by](a.test.ts#L88))`,
    },
  ]);

  assert.deepEqual(index.get("a.test.ts"), {
    lines: new Set([88]),
    wholeFile: false,
  });
});

test("indexes a link without #L as a whole-file link", () => {
  const index = buildLinkIndex([
    { path: "specs/a/spec.md", content: `Works. ([validated by](a.test.ts))` },
  ]);

  assert.equal(index.get("a.test.ts").wholeFile, true);
});

test("collects multiple tests linked from one statement", () => {
  const index = buildLinkIndex([
    {
      path: "specs/a/spec.md",
      content: `Works. ([a](a.test.ts#L1), [b](b.test.ts#L2))`,
    },
  ]);

  assert.deepEqual([...index.keys()].sort(), ["a.test.ts", "b.test.ts"]);
});

test("excludes non-test (code) links", () => {
  const index = buildLinkIndex([
    { path: "specs/a/spec.md", content: `Works. ([impl](src/foo.ts#L3))` },
  ]);

  assert.equal(index.size, 0);
});

test("readSpecFiles reads specs and adrs, buildLinkIndex covers both", () => {
  const index = buildLinkIndex(readSpecFiles(FIXTURES));

  assert.deepEqual(index.get("tests/linked.test.ts").lines, new Set([2]));
  assert.equal(index.get("tests/adr-linked.test.ts").wholeFile, true);
});

test("readSpecFiles skips absent directories", () => {
  assert.deepEqual(readSpecFiles(FIXTURES, ["does-not-exist"]), []);
});

test("resolves a dir-relative ../ href to the repo-root key", () => {
  const index = buildLinkIndex([
    {
      path: "specs/foo/spec.md",
      content: `Works. ([validated by](../../apps/x.test.ts#L5))`,
    },
  ]);

  assert.deepEqual(index.get("apps/x.test.ts").lines, new Set([5]));
  assert.equal(index.has("../../apps/x.test.ts"), false);
});

test("corpusExists true when a root dir is present, false otherwise", () => {
  assert.equal(corpusExists(FIXTURES), true);
  assert.equal(corpusExists(FIXTURES, ["nope"]), false);
});
