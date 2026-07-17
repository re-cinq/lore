import { describe, it, expect } from "vitest";
import {
  matchesSpecStatusFilter,
  parseDocStatus,
  parseSpecStatus,
} from "./spec-status";

const spec = (statusCell: string) =>
  `# Feature\n\n| Field | Value |\n|---|---|\n| Feature | X |\n| Status | ${statusCell} |\n| Owner | Y |\n`;

describe("parseSpecStatus", () => {
  it("parses a plain Shipped row", () => {
    expect(parseSpecStatus(spec("Shipped"))).toEqual({
      status: "shipped",
      label: "Shipped",
    });
  });

  it("parses a bold Draft row", () => {
    expect(parseSpecStatus(spec("**Draft**"))).toEqual({
      status: "draft",
      label: "Draft",
    });
  });

  it("keeps the leading word as label when the value carries a suffix", () => {
    expect(
      parseSpecStatus(spec("Shipped (v3) — supersedes v1 and v2")),
    ).toEqual({ status: "shipped", label: "Shipped" });
    expect(
      parseSpecStatus(
        spec("Complete — lore-api is pure hapi (all 12 groups migrated)"),
      ),
    ).toEqual({ status: "shipped", label: "Complete" });
    expect(
      parseSpecStatus(spec("Implemented — merged to `main` 2026-06-30")),
    ).toEqual({ status: "shipped", label: "Implemented" });
  });

  it("buckets In Progress and In review as in-progress", () => {
    expect(parseSpecStatus(spec("In Progress"))?.status).toBe("in-progress");
    expect(parseSpecStatus(spec("In review"))?.status).toBe("in-progress");
  });

  it("buckets Rejected with its note as rejected", () => {
    expect(
      parseSpecStatus(spec("Rejected (2026-06-17) — see note below")),
    ).toEqual({ status: "rejected", label: "Rejected" });
  });

  it("buckets Retired (and superseded/removed) as retired", () => {
    expect(parseSpecStatus(spec("Retired"))).toEqual({
      status: "retired",
      label: "Retired",
    });
    expect(parseSpecStatus(spec("Removed (cutover 2026-06-29)"))?.status).toBe(
      "retired",
    );
  });

  it("matches the Status label case-insensitively", () => {
    expect(parseSpecStatus(spec("shipped"))?.status).toBe("shipped");
  });

  it("returns null when no Status row exists", () => {
    expect(parseSpecStatus("# Feature\n\nJust prose.\n")).toBeNull();
  });

  it("returns null for an unrecognized status value", () => {
    expect(parseSpecStatus(spec("Contemplating"))).toBeNull();
  });

  it("ignores a non-table line containing the word Status", () => {
    expect(parseSpecStatus("# X\n\nStatus is unclear.\n")).toBeNull();
  });
});

const adr = (statusValue: string) =>
  `---\nadr_number: 7\ntitle: "Example"\nstatus: ${statusValue}\ndate: 2026-06-23\n---\n\n# ADR-007: Example\n\nLead paragraph.\n\n## Context\n`;

describe("parseDocStatus", () => {
  it("buckets frontmatter accepted as shipped with label Accepted", () => {
    expect(parseDocStatus(adr("accepted"), "adr")).toEqual({
      status: "shipped",
      label: "Accepted",
    });
  });

  it("buckets frontmatter proposed as in-progress", () => {
    expect(parseDocStatus(adr("proposed"), "adr")?.status).toBe("in-progress");
  });

  it("buckets frontmatter superseded as retired", () => {
    expect(parseDocStatus(adr("superseded"), "adr")?.status).toBe("retired");
  });

  it("buckets a multi-word value with label In progress", () => {
    expect(parseDocStatus(adr("in progress"), "adr")).toEqual({
      status: "in-progress",
      label: "In progress",
    });
  });

  it("strips quotes around the frontmatter value", () => {
    expect(parseDocStatus(adr('"draft"'), "adr")).toEqual({
      status: "draft",
      label: "Draft",
    });
  });

  it("returns null when the doc has no frontmatter", () => {
    expect(
      parseDocStatus(
        "# ADR-001: X\n\nProse only.\n\n## Status\n\nAccepted\n",
        "adr",
      ),
    ).toBeNull();
  });

  it("ignores a body Status section that disagrees with frontmatter", () => {
    const doc = `${adr("draft")}\n## Status\n\nAccepted\n`;

    expect(parseDocStatus(doc, "adr")?.status).toBe("draft");
  });

  it("returns null for an unrecognized frontmatter value", () => {
    expect(parseDocStatus(adr("contemplating"), "adr")).toBeNull();
  });

  it("parses spec kind identically to parseSpecStatus", () => {
    const doc = spec("Shipped (v3) — supersedes v1 and v2");

    expect(parseDocStatus(doc, "spec")).toEqual(parseSpecStatus(doc));
  });

  it("buckets a spec Proposed row as in-progress", () => {
    expect(parseSpecStatus(spec("Proposed"))?.status).toBe("in-progress");
  });
});

describe("matchesSpecStatusFilter", () => {
  it("matches everything on all, including unparsed specs", () => {
    expect(matchesSpecStatusFilter(undefined, "all")).toBe(true);
    expect(
      matchesSpecStatusFilter({ status: "draft", label: "Draft" }, "all"),
    ).toBe(true);
  });

  it("matches only the selected bucket otherwise", () => {
    const shipped = { status: "shipped" as const, label: "Shipped" };

    expect(matchesSpecStatusFilter(shipped, "shipped")).toBe(true);
    expect(matchesSpecStatusFilter(shipped, "draft")).toBe(false);
    expect(matchesSpecStatusFilter(undefined, "shipped")).toBe(false);
  });
});
