import { test } from "node:test";
import assert from "node:assert/strict";

import { statusMismatch } from "./status-coverage.mjs";

const LINK = "([validated by](payments.test.ts#L10))";

// Intro prose under the H1 anchors `buildIntroOrdinals` to the H1, so the two
// requirement sentences land on lines 11 and 13 as testable statements. The
// status row sits on line 7.
const spec = (status) =>
  [
    "# My Feature", // 1
    "", // 2
    "Intro paragraph describing the feature.", // 3
    "", // 4
    "| Field | Value |", // 5
    "|---|---|", // 6
    `| Status | ${status} |`, // 7
    "", // 8
    "## Functional Requirements", // 9
    "", // 10
    "The system returns a receipt for every payment.", // 11
    "", // 12
    "The system emails the receipt to the payer.", // 13
  ].join("\n");

const linkFirst = (content) =>
  content.replace("for every payment.", `for every payment. ${LINK}`);
const linkSecond = (content) =>
  content.replace("to the payer.", `to the payer. ${LINK}`);

const specNoStatusRow = [
  "# My Feature",
  "",
  "Intro paragraph describing the feature.",
  "",
  "**Status:** Implemented — 2026-06-17",
  "",
  "## Functional Requirements",
  "",
  "The system returns a receipt for every payment.",
].join("\n");

// Every non-intro statement sits under a narrative heading — nothing testable.
const specNarrativeOnly = [
  "# My Feature",
  "",
  "Intro paragraph describing the feature.",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Shipped |",
  "",
  "## Rationale",
  "",
  "We chose receipts because auditors require them.",
].join("\n");

const adr = (status) =>
  [
    "---", // 1
    `status: ${status}`, // 2
    "---", // 3
    "", // 4
    "# ADR-1 Retry policy", // 5
    "", // 6
    "Context for this decision.", // 7
    "", // 8
    "## Behavior", // 9
    "", // 10
    "The gateway retries failed requests three times.", // 11
  ].join("\n");

const adrNoFrontmatter = [
  "# ADR-36 Module import boundaries",
  "",
  "Context for this decision.",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Accepted |",
  "",
  "## Behavior",
  "",
  "The gateway retries failed requests three times.",
].join("\n");

test("returns null when a Draft spec has no linked statements", () => {
  assert.equal(statusMismatch(spec("Draft"), "spec"), null);
});

test("returns null when a Shipped spec has every statement linked", () => {
  assert.equal(statusMismatch(linkSecond(linkFirst(spec("Shipped"))), "spec"), null);
});

test("returns null when an In Progress spec has some statements linked", () => {
  assert.equal(statusMismatch(linkFirst(spec("In Progress")), "spec"), null);
});

test("expects draft when a Shipped spec has no linked statements", () => {
  assert.deepEqual(statusMismatch(spec("Shipped"), "spec"), {
    reason: "tier",
    expected: "draft",
    actual: "shipped",
    testable: 2,
    linked: 0,
    line: 7,
  });
});

test("expects in-progress when a Draft spec has one of two statements linked", () => {
  assert.deepEqual(statusMismatch(linkFirst(spec("Draft")), "spec"), {
    reason: "tier",
    expected: "in-progress",
    actual: "draft",
    testable: 2,
    linked: 1,
    line: 7,
  });
});

test("expects in-progress when a Shipped spec has one of two statements linked", () => {
  assert.deepEqual(statusMismatch(linkFirst(spec("Shipped")), "spec"), {
    reason: "tier",
    expected: "in-progress",
    actual: "shipped",
    testable: 2,
    linked: 1,
    line: 7,
  });
});

test("expects shipped when a Draft spec has every statement linked", () => {
  assert.deepEqual(statusMismatch(linkSecond(linkFirst(spec("Draft"))), "spec"), {
    reason: "tier",
    expected: "shipped",
    actual: "draft",
    testable: 2,
    linked: 2,
    line: 7,
  });
});

test("returns null for a Rejected spec regardless of coverage", () => {
  assert.equal(statusMismatch(spec("Rejected"), "spec"), null);
});

test("returns null for a Retired spec regardless of coverage", () => {
  assert.equal(statusMismatch(spec("Retired"), "spec"), null);
});

test("returns null for a Shipped spec whose statements are all narrative", () => {
  assert.equal(statusMismatch(specNarrativeOnly, "spec"), null);
});

test("reports untagged at line 1 when a spec has no status row", () => {
  assert.deepEqual(statusMismatch(specNoStatusRow, "spec"), {
    reason: "untagged",
    line: 1,
  });
});

test("reports untagged at the status row when the value is not a known status", () => {
  assert.deepEqual(statusMismatch(spec("Bananas"), "spec"), {
    reason: "untagged",
    line: 7,
  });
});

test("expects draft when a shipped ADR has no linked statements", () => {
  assert.deepEqual(statusMismatch(adr("shipped"), "adr"), {
    reason: "tier",
    expected: "draft",
    actual: "shipped",
    testable: 1,
    linked: 0,
    line: 2,
  });
});

test("returns null when an accepted ADR has every statement linked", () => {
  const linked = adr("accepted").replace(
    "three times.",
    `three times. ${LINK}`,
  );
  assert.equal(statusMismatch(linked, "adr"), null);
});

test("returns null for a superseded ADR regardless of coverage", () => {
  assert.equal(statusMismatch(adr("superseded"), "adr"), null);
});

test("reports untagged at line 1 when an ADR has a status table instead of frontmatter", () => {
  assert.deepEqual(statusMismatch(adrNoFrontmatter, "adr"), {
    reason: "untagged",
    line: 1,
  });
});
