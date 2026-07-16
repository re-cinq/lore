import { RuleTester } from "eslint";
import markdown from "@eslint/markdown";
import rule from "./require-status-matches-coverage.mjs";

const ruleTester = new RuleTester({
  plugins: { markdown },
  language: "markdown/gfm",
});

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
const linkBoth = (content) => linkSecond(linkFirst(content));

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

const linkAdr = (content) =>
  content.replace("three times.", `three times. ${LINK}`);

// Every non-intro statement sits under a narrative heading — no testable
// statement, so no tier is derivable and the doc is left alone.
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

const specProseStatus = [
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

const adrStatusTable = [
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

ruleTester.run("require-status-matches-coverage", rule, {
  valid: [
    // status matches coverage: none -> Draft, partial -> In Progress, full -> Shipped
    { code: spec("Draft"), filename: "specs/my-feature/spec.md" },
    { code: linkFirst(spec("In Progress")), filename: "specs/my-feature/spec.md" },
    { code: linkBoth(spec("Shipped")), filename: "specs/my-feature/spec.md" },
    { code: adr("draft"), filename: "adrs/ADR-1.md" },
    { code: linkAdr(adr("accepted")), filename: "adrs/ADR-1.md" },
    // terminal statuses skip the rule
    { code: spec("Rejected"), filename: "specs/my-feature/spec.md" },
    { code: spec("Retired"), filename: "specs/my-feature/spec.md" },
    { code: adr("superseded"), filename: "adrs/ADR-1.md" },
    // no testable statement -> no tier to compare against
    { code: specNarrativeOnly, filename: "specs/my-feature/spec.md" },
    // outside specs/ and adrs/ the rule does not apply
    { code: spec("Shipped"), filename: "docs/readme.md" },
    { code: specProseStatus, filename: "docs/readme.md" },
  ],
  invalid: [
    {
      code: spec("Shipped"),
      filename: "specs/my-feature/spec.md",
      errors: [
        {
          messageId: "statusMismatch",
          line: 7,
          data: {
            corpus: "spec",
            actual: "shipped",
            expected: "Draft",
            linked: 0,
            testable: 2,
          },
        },
      ],
    },
    {
      code: linkFirst(spec("Draft")),
      filename: "specs/my-feature/spec.md",
      errors: [
        {
          messageId: "statusMismatch",
          line: 7,
          data: {
            corpus: "spec",
            actual: "draft",
            expected: "In Progress",
            linked: 1,
            testable: 2,
          },
        },
      ],
    },
    {
      code: linkBoth(spec("Draft")),
      filename: "specs/my-feature/spec.md",
      errors: [{ messageId: "statusMismatch", line: 7 }],
    },
    {
      code: adr("shipped"),
      filename: "adrs/ADR-1.md",
      errors: [
        {
          messageId: "statusMismatch",
          line: 2,
          data: {
            corpus: "ADR",
            actual: "shipped",
            expected: "draft",
            linked: 0,
            testable: 1,
          },
        },
      ],
    },
    {
      code: specProseStatus,
      filename: "specs/local-read-cache/spec.md",
      errors: [{ messageId: "untagged", line: 1 }],
    },
    {
      code: spec("Bananas"),
      filename: "specs/my-feature/spec.md",
      errors: [{ messageId: "untagged", line: 7 }],
    },
    {
      code: adrStatusTable,
      filename: "adrs/ADR-36.md",
      errors: [{ messageId: "untagged", line: 1 }],
    },
  ],
});
