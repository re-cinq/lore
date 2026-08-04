import { describe, it, expect } from "vitest";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker
// isolation), so the doc-status buckets are hand-duplicated. This CI-only test
// (runs in a full checkout) imports shared's PURE spec-status.ts by file path —
// never the package — to keep the parse core in lockstep: the same raw status
// value must bucket and label identically for the web-ui pill and the
// require-statement-links lint tier. The union shape itself is guarded at
// compile time by scripts/type-drift/spec-status.drift.ts.
import { parseSpecStatus, statusInfoFromValue } from "./spec-status";
import { docStatusPill } from "../../../../libs/shared/src/spec-status";

// One raw value per BUCKETS regex alternative, plus decorated, unknown, and
// bold/suffixed forms — generated coverage of every bucketing branch.
const VALUES = [
  "Draft",
  "In Progress",
  "In review",
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
  "Shipped (v3) — supersedes v1",
  "Implemented — 2026-08",
  "**Accepted**",
  "Some day maybe",
  "",
];

describe("spec-status parity (web-ui mirror vs shared canonical)", () => {
  it.each(VALUES)("buckets and labels spec status %j identically", (value) => {
    const markdown = `# Title\n\n| Status | ${value} |\n\nBody.`;

    expect(parseSpecStatus(markdown)).toEqual(docStatusPill(markdown, "spec"));
  });

  it.each(VALUES)("buckets and labels ADR status %j identically", (value) => {
    const adr = `---\nstatus: ${value}\n---\n\nBody.`;

    expect(statusInfoFromValue(value)).toEqual(docStatusPill(adr, "adr"));
  });

  it("both return null for a document with no status row", () => {
    expect(parseSpecStatus("# Title\n\nBody.")).toBeNull();
    expect(docStatusPill("# Title\n\nBody.", "spec")).toBeNull();
  });
});
