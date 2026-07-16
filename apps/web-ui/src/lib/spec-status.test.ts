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
    expect(parseSpecStatus(spec("Shipped"))).toBe("shipped");
  });

  it("parses a bold Draft row", () => {
    expect(parseSpecStatus(spec("**Draft**"))).toBe("draft");
  });

  it("buckets a value carrying a suffix by its leading word", () => {
    expect(parseSpecStatus(spec("Shipped (v3) — supersedes v1 and v2"))).toBe(
      "shipped",
    );
    expect(
      parseSpecStatus(
        spec("Complete — lore-api is pure hapi (all 12 groups migrated)"),
      ),
    ).toBe("shipped");
    expect(
      parseSpecStatus(spec("Implemented — merged to `main` 2026-06-30")),
    ).toBe("shipped");
  });

  it("buckets In Progress and In review as in-progress", () => {
    expect(parseSpecStatus(spec("In Progress"))).toBe("in-progress");
    expect(parseSpecStatus(spec("In review"))).toBe("in-progress");
  });

  it("buckets Rejected with its note as rejected", () => {
    expect(
      parseSpecStatus(spec("Rejected (2026-06-17) — see note below")),
    ).toBe("rejected");
  });

  it("buckets Retired (and superseded/removed) as retired", () => {
    expect(parseSpecStatus(spec("Retired"))).toBe("retired");
    expect(parseSpecStatus(spec("Removed (cutover 2026-06-29)"))).toBe(
      "retired",
    );
  });

  it("matches the Status label case-insensitively", () => {
    expect(parseSpecStatus(spec("shipped"))).toBe("shipped");
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
  // `accepted` is MADR's word for shipped, and Lore's own onboard prompt tells
  // new repos to write it — the bucket is what both corpora agree on.
  it("buckets frontmatter accepted as shipped", () => {
    expect(parseDocStatus(adr("accepted"), "adr")).toBe("shipped");
  });

  it("buckets frontmatter proposed as in-progress", () => {
    expect(parseDocStatus(adr("proposed"), "adr")).toBe("in-progress");
  });

  it("buckets frontmatter superseded as retired", () => {
    expect(parseDocStatus(adr("superseded"), "adr")).toBe("retired");
  });

  it("buckets a multi-word value as in-progress", () => {
    expect(parseDocStatus(adr("in progress"), "adr")).toBe("in-progress");
  });

  it("strips quotes around the frontmatter value", () => {
    expect(parseDocStatus(adr('"draft"'), "adr")).toBe("draft");
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

    expect(parseDocStatus(doc, "adr")).toBe("draft");
  });

  it("returns null for an unrecognized frontmatter value", () => {
    expect(parseDocStatus(adr("contemplating"), "adr")).toBeNull();
  });

  it("parses spec kind identically to parseSpecStatus", () => {
    const doc = spec("Shipped (v3) — supersedes v1 and v2");

    expect(parseDocStatus(doc, "spec")).toBe(parseSpecStatus(doc));
  });

  it("buckets a spec Proposed row as in-progress", () => {
    expect(parseSpecStatus(spec("Proposed"))).toBe("in-progress");
  });

  // The point of the collapse: one state, one pill. A spec saying `Implemented`
  // and an ADR saying `accepted` are the same status, and every surface must
  // render them the same.
  it("buckets a spec Implemented row and an ADR accepted value identically", () => {
    expect(parseDocStatus(spec("Implemented"), "spec")).toBe(
      parseDocStatus(adr("accepted"), "adr"),
    );
  });
});

describe("matchesSpecStatusFilter", () => {
  it("matches everything on all, including unparsed specs", () => {
    expect(matchesSpecStatusFilter(undefined, "all")).toBe(true);
    expect(matchesSpecStatusFilter("draft", "all")).toBe(true);
  });

  it("matches only the selected bucket otherwise", () => {
    expect(matchesSpecStatusFilter("shipped", "shipped")).toBe(true);
    expect(matchesSpecStatusFilter("shipped", "draft")).toBe(false);
    expect(matchesSpecStatusFilter(undefined, "shipped")).toBe(false);
  });
});
