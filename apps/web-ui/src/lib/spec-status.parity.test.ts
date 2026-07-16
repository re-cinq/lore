import { describe, it, expect } from "vitest";
import { parseSpecStatus } from "./spec-status";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker isolation),
// so the status buckets are hand-duplicated. This CI-only test (runs in a full
// checkout) imports shared's PURE spec-status.ts by file path — never the package — to
// keep the two in lockstep. ADR-037 names shared as the single source for the
// vocabulary; this is what makes that claim enforced rather than aspirational.
//
// Buckets only: web-ui's `label` (a truncated display string) has no shared
// counterpart, and shared's ADR-frontmatter parsing has no web-ui counterpart.
import { parseDocStatus } from "../../../../libs/shared/src/spec-status";

const specWith = (status: string) => `# Feature Specification: Thing

| Field   | Value   |
|---------|---------|
| Status  | ${status} |
| Owner   | Someone |
`;

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
  it.each(VALUES)("buckets %s identically in both implementations", (value) => {
    const markdown = specWith(value);

    // web-ui returns null for an unbucketed value; shared returns { status: null }.
    // Normalize to the bucket-or-null both actually mean.
    expect(parseSpecStatus(markdown)?.status ?? null).toBe(
      parseDocStatus(markdown, "spec").status,
    );
  });

  it("both find no status when the table has no Status row", () => {
    const markdown =
      "# Thing\n\n| Field | Value |\n|-------|-------|\n| Owner | Someone |\n";

    expect(parseSpecStatus(markdown)).toBeNull();
    expect(parseDocStatus(markdown, "spec").status).toBeNull();
  });
});
