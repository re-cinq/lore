import { describe, it, expect } from "vitest";
import { parseDocStatus as parseWebUi } from "./spec-status";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker isolation),
// so the status buckets are hand-duplicated. This CI-only test (runs in a full
// checkout) imports shared's PURE spec-status.ts by file path — never the package — to
// keep the two in lockstep. ADR-037 names shared as the single source for the
// vocabulary; this is what makes that claim enforced rather than aspirational.
//
// Both corpora are covered, because both mirrors parse both: a spec's `| Status |`
// table row and an ADR's frontmatter `status:`. Buckets only — web-ui's display
// concerns (SPEC_STATUS_LABEL / _COLOR / _ORDER) are a UI table with no shared
// counterpart, and shared's write-side vocabulary (statusLabel, what a status
// flip puts into a file) is a different table on purpose.
import { parseDocStatus as parseShared } from "../../../../libs/shared/src/spec-status";

const specWith = (status: string) => `# Feature Specification: Thing

| Field   | Value   |
|---------|---------|
| Status  | ${status} |
| Owner   | Someone |
`;

const adrWith = (status: string) =>
  `---\nadr_number: 7\ntitle: "Example"\nstatus: ${status}\ndate: 2026-06-23\n---\n\n# ADR-007: Example\n\n## Context\n`;

// Every synonym in shared's bucket table, plus the shapes that bit us before:
// bold cells, a trailing qualifier, and a value in no bucket at all.
const VALUES = [
  "Draft",
  "In Progress",
  "In Review",
  "Planning",
  "WIP",
  "Proposed",
  "Shipped",
  "Implemented",
  "Complete",
  "Accepted",
  "Done",
  "Live",
  "Retired",
  "Superseded",
  "Removed",
  "Deprecated",
  "Obsolete",
  "Rejected",
  "Abandoned",
  "**Draft**",
  "Implemented — 2026-07-16",
  "Accepted (pre-implementation)",
  "Bananas",
];

describe("spec status bucket parity (web-ui mirror vs shared canonical)", () => {
  // web-ui returns the bucket-or-null directly; shared wraps it in { status }.
  it.each(VALUES)("buckets spec status %s identically", (value) => {
    const markdown = specWith(value);

    expect(parseWebUi(markdown, "spec")).toBe(
      parseShared(markdown, "spec").status,
    );
  });

  it.each(VALUES)("buckets ADR frontmatter status %s identically", (value) => {
    const markdown = adrWith(value);

    expect(parseWebUi(markdown, "adr")).toBe(
      parseShared(markdown, "adr").status,
    );
  });

  it("both find no status when the table has no Status row", () => {
    const markdown =
      "# Thing\n\n| Field | Value |\n|-------|-------|\n| Owner | Someone |\n";

    expect(parseWebUi(markdown, "spec")).toBeNull();
    expect(parseShared(markdown, "spec").status).toBeNull();
  });

  it("both find no status when an ADR has no frontmatter", () => {
    const markdown = "# ADR-001: X\n\nProse only.\n\n## Status\n\nAccepted\n";

    expect(parseWebUi(markdown, "adr")).toBeNull();
    expect(parseShared(markdown, "adr").status).toBeNull();
  });
});
