import { describe, it, expect } from "vitest";
import { parseSpecStatus, statusInfoFromValue } from "./spec-status";
import { docStatusPill } from "../../../../libs/shared/src/spec-status";

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
