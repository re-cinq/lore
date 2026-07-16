import { RuleTester } from "eslint";
import markdown from "@eslint/markdown";
import rule from "./require-statement-links.mjs";

const ruleTester = new RuleTester({
  plugins: { markdown },
  language: "markdown/gfm",
});

// Intro prose under the H1 is required so `buildIntroOrdinals` anchors the intro
// to the H1 (not to the first requirements section). The testable statement then
// lands on line 11 under a non-narrative heading.
const shippedUnlinked = [
  "# My Feature", // 1
  "", // 2
  "Intro paragraph describing the feature.", // 3
  "", // 4
  "| Field | Value |", // 5
  "|---|---|", // 6
  "| Status | Shipped |", // 7
  "", // 8
  "## Functional Requirements", // 9
  "", // 10
  "The system returns a receipt for every payment.", // 11
].join("\n");

const draftUnlinked = shippedUnlinked.replace("Shipped", "Draft");

const shippedLinked = shippedUnlinked.replace(
  "for every payment.",
  "for every payment. ([validated by](payments.test.ts#L10))",
);

const draftLinked = draftUnlinked.replace(
  "for every payment.",
  "for every payment. ([validated by](payments.test.ts#L10))",
);

// A finalized spec whose only non-intro statement sits under a narrative section
// (Rationale) — exempt by the section heuristic, not by intro.
const shippedNarrativeOnly = [
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

const acceptedAdrUnlinked = [
  "---", // 1
  "status: accepted", // 2
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

const proposedAdrUnlinked = acceptedAdrUnlinked.replace("accepted", "proposed");

// rejected specs / superseded ADRs are the skip tier — the rule does not run.
const rejectedUnlinked = shippedUnlinked.replace("Shipped", "Rejected");
const supersededAdrUnlinked = acceptedAdrUnlinked.replace(
  "accepted",
  "superseded",
);

// A rejected spec / superseded ADR is skipped; every other status warns.
ruleTester.run("require-statement-links", rule, {
  valid: [
    // skip tier — the rule does not run
    { code: rejectedUnlinked, filename: "specs/my-feature/spec.md" },
    { code: supersededAdrUnlinked, filename: "adrs/ADR-1.md" },
    // fully linked, nothing to flag
    { code: draftLinked, filename: "specs/my-feature/spec.md" },
    { code: shippedLinked, filename: "specs/my-feature/spec.md" },
    // every statement is intro/narrative (heuristic exempts them)
    { code: shippedNarrativeOnly, filename: "specs/my-feature/spec.md" },
    // outside specs/ and adrs/ the rule does not apply
    { code: shippedUnlinked, filename: "docs/readme.md" },
  ],
  invalid: [
    {
      code: draftUnlinked,
      filename: "specs/my-feature/spec.md",
      errors: [{ messageId: "unlinkedStatement", line: 11 }],
    },
    {
      code: shippedUnlinked,
      filename: "specs/my-feature/spec.md",
      errors: [{ messageId: "unlinkedStatement", line: 11 }],
    },
    {
      code: proposedAdrUnlinked,
      filename: "adrs/ADR-1.md",
      errors: [{ messageId: "unlinkedStatement", line: 11 }],
    },
    {
      code: acceptedAdrUnlinked,
      filename: "adrs/ADR-1.md",
      errors: [{ messageId: "unlinkedStatement", line: 11 }],
    },
  ],
});
