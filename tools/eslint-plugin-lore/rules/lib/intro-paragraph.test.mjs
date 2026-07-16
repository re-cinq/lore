import { test } from "node:test";
import assert from "node:assert/strict";

import { hasLeadParagraph } from "./intro-paragraph.mjs";

const specWithIntro = [
  "# Feature Specification: Widgets",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Draft |",
  "",
  "Widgets let teams assemble reusable parts across every repository.",
  "",
  "## Problem Statement",
  "",
  "When a job runs it needs parts.",
].join("\n");

const specNoIntro = [
  "# Feature Specification: Widgets",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Draft |",
  "",
  "## Problem Statement",
  "",
  "When a job runs it needs parts.",
].join("\n");

// A `**Status:** …` bold line in the region is not a real intro paragraph.
const specStatusLineOnly = [
  "# Feature Specification: Widgets",
  "",
  "**Status:** Implemented — 2026",
  "",
  "## Problem Statement",
  "",
  "When a job runs it needs parts.",
].join("\n");

const specShortIntro = specWithIntro.replace(
  "Widgets let teams assemble reusable parts across every repository.",
  "Too short.",
);

const adrWithIntro = [
  "---",
  "status: accepted",
  "---",
  "",
  "# ADR-1: Retry policy",
  "",
  "We retry failed gateway calls so transient errors do not surface to users.",
  "",
  "## Status",
  "",
  "Accepted",
  "",
  "## Context",
  "",
  "The gateway is flaky.",
].join("\n");

const adrNoIntro = [
  "---",
  "status: accepted",
  "---",
  "",
  "# ADR-1: Retry policy",
  "",
  "## Status",
  "",
  "Accepted",
  "",
  "## Context",
  "",
  "The gateway is flaky.",
].join("\n");

// No `##` heading anywhere: the whole body is the region, still needs a lead para.
const specNoSections = [
  "# Feature Specification: Widgets",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Draft |",
  "",
  "Widgets let teams assemble reusable parts across every repository.",
].join("\n");

test("spec with a lead paragraph before the first section passes", () => {
  assert.equal(hasLeadParagraph(specWithIntro, "spec"), true);
});

test("spec that jumps from status table to a section fails", () => {
  assert.equal(hasLeadParagraph(specNoIntro, "spec"), false);
});

test("spec whose region holds only a bold status line fails", () => {
  assert.equal(hasLeadParagraph(specStatusLineOnly, "spec"), false);
});

test("spec with an intro shorter than the minimum fails", () => {
  assert.equal(hasLeadParagraph(specShortIntro, "spec"), false);
});

test("adr with a lead paragraph after the H1 passes", () => {
  assert.equal(hasLeadParagraph(adrWithIntro, "adr"), true);
});

test("adr that jumps from frontmatter and H1 to Status fails", () => {
  assert.equal(hasLeadParagraph(adrNoIntro, "adr"), false);
});

test("spec with no section headings still requires a lead paragraph", () => {
  assert.equal(hasLeadParagraph(specNoSections, "spec"), true);
});
