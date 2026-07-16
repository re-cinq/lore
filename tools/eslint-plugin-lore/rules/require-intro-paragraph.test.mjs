import { RuleTester } from "eslint";
import markdown from "@eslint/markdown";
import rule from "./require-intro-paragraph.mjs";

const ruleTester = new RuleTester({
  plugins: { markdown },
  language: "markdown/gfm",
});

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
].join("\n");

ruleTester.run("require-intro-paragraph", rule, {
  valid: [
    { code: specWithIntro, filename: "specs/my-feature/spec.md" },
    { code: adrWithIntro, filename: "adrs/ADR-1.md" },
    // outside specs/ and adrs/ the rule does not apply
    { code: specNoIntro, filename: "docs/readme.md" },
  ],
  invalid: [
    {
      code: specNoIntro,
      filename: "specs/my-feature/spec.md",
      errors: [{ messageId: "missingIntro", line: 1 }],
    },
    {
      code: adrNoIntro,
      filename: "adrs/ADR-1.md",
      errors: [{ messageId: "missingIntro", line: 1 }],
    },
  ],
});
