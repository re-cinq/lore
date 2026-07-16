import { test } from "node:test";
import assert from "node:assert/strict";

import { docKind } from "./doc-kind.mjs";

test("returns spec for a spec.md under specs/", () => {
  assert.equal(docKind("specs/my-feature/spec.md"), "spec");
});

test("returns spec for an absolute path containing /specs/", () => {
  assert.equal(docKind("/home/dev/lore/specs/my-feature/spec.md"), "spec");
});

test("returns adr for an ADR under adrs/", () => {
  assert.equal(docKind("adrs/ADR-001-a-decision.md"), "adr");
});

test("returns adr for an absolute path containing /adrs/", () => {
  assert.equal(docKind("/home/dev/lore/adrs/ADR-001-a-decision.md"), "adr");
});

test("returns adr for a windows-separated ADR path", () => {
  assert.equal(docKind("C:\\dev\\lore\\adrs\\ADR-001-a-decision.md"), "adr");
});

test("returns null for a doc outside specs/ and adrs/", () => {
  assert.equal(docKind("docs/readme.md"), null);
});

test("returns adr when both segments appear and adrs/ is the deeper one", () => {
  assert.equal(docKind("specs/my-feature/adrs/ADR-001.md"), "adr");
});
