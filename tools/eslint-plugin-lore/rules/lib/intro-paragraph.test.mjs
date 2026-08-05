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

// A structural line abutting a too-short intro must not pad it to the minimum.
const specShortIntroPaddedByTable = [
  "# Feature Specification: Widgets",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Draft |",
  "",
  "Too short.",
  "| a table row long enough to pad past the forty character minimum |",
  "",
  "## Problem Statement",
].join("\n");

const specShortIntroPaddedByQuote = [
  "# Feature Specification: Widgets",
  "",
  "Too short.",
  "> a blockquote long enough to pad past the forty character minimum",
  "",
  "## Problem Statement",
].join("\n");

const specOrderedListIntro = [
  "# Feature Specification: Widgets",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Draft |",
  "",
  "1. An ordered list item is not an introductory paragraph at all.",
  "",
  "## Problem Statement",
].join("\n");

const specPlusListIntro = specOrderedListIntro.replace(
  "1. An ordered",
  "+ An ordered",
);

test("spec whose short intro is padded by an adjoining table row fails", () => {
  assert.equal(hasLeadParagraph(specShortIntroPaddedByTable, "spec"), false);
});

test("spec whose short intro is padded by an adjoining blockquote fails", () => {
  assert.equal(hasLeadParagraph(specShortIntroPaddedByQuote, "spec"), false);
});

test("spec whose only intro-region prose is an ordered list item fails", () => {
  assert.equal(hasLeadParagraph(specOrderedListIntro, "spec"), false);
});

test("spec whose only intro-region prose is a + list item fails", () => {
  assert.equal(hasLeadParagraph(specPlusListIntro, "spec"), false);
});

// A Note blockquote whose wrapped last line dropped its leading `>` is a lazy
// continuation of the quote, not a lead paragraph — a line-based check must not
// mistake it for prose.
const specLazyBlockquoteContinuation = [
  "# Feature Specification: Widgets",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Draft |",
  "",
  "> **Note:** this blockquote wraps across several lines and the author",
  "> dropped the leading marker on the very last continuation line, so it",
  "reads as prose to a check that only inspects one line at a time.",
  "",
  "## Problem Statement",
].join("\n");

test("spec whose only intro-region prose is a lazy blockquote continuation fails", () => {
  assert.equal(hasLeadParagraph(specLazyBlockquoteContinuation, "spec"), false);
});
