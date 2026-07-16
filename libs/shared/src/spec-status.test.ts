import { describe, it, expect } from "vitest";
import {
  parseDocStatus,
  statusTier,
  rewriteAdrStatusRow,
  rewriteSpecStatusRow,
} from "./spec-status.js";

describe("parseDocStatus (spec)", () => {
  const table = (status: string) =>
    ["| Field | Value |", "|---|---|", `| Status | ${status} |`, ""].join("\n");

  it("buckets a Shipped spec as shipped", () => {
    expect(parseDocStatus(table("Shipped"), "spec")).toEqual({
      status: "shipped",
    });
  });

  it("folds Implemented / Complete / Accepted / Done / Live into shipped", () => {
    for (const value of [
      "Implemented",
      "Complete",
      "Accepted",
      "Done",
      "Live",
    ]) {
      expect(parseDocStatus(table(value), "spec").status).toBe("shipped");
    }
  });

  it("strips bold markers and trailing prose before bucketing", () => {
    expect(parseDocStatus(table("**Shipped**"), "spec").status).toBe("shipped");
    expect(
      parseDocStatus(table("Shipped (v3) — supersedes v1 and v2"), "spec")
        .status,
    ).toBe("shipped");
  });

  it("buckets a Draft spec as draft", () => {
    expect(parseDocStatus(table("**Draft**"), "spec")).toEqual({
      status: "draft",
    });
  });

  it("buckets In Progress / In Review / Planning / WIP as in-progress", () => {
    for (const value of ["In Progress", "In Review", "Planning", "WIP"]) {
      expect(parseDocStatus(table(value), "spec").status).toBe("in-progress");
    }
  });

  it("buckets Rejected as rejected", () => {
    expect(parseDocStatus(table("Rejected (2026-06-17)"), "spec")).toEqual({
      status: "rejected",
    });
  });

  it("buckets Retired / Removed / Deprecated as retired", () => {
    for (const value of ["Retired", "Removed", "Deprecated"]) {
      expect(parseDocStatus(table(value), "spec").status).toBe("retired");
    }
  });

  it("returns null status when no Status row is present", () => {
    expect(parseDocStatus("# Spec\n\nNo table here.\n", "spec")).toEqual({
      status: null,
    });
  });
});

describe("parseDocStatus (adr)", () => {
  const frontmatter = (status: string) =>
    [
      "---",
      "adr_number: 16",
      `status: ${status}`,
      "date: 2026-04-28",
      "---",
      "",
    ].join("\n");

  it("folds an accepted ADR into shipped", () => {
    expect(parseDocStatus(frontmatter("accepted"), "adr")).toEqual({
      status: "shipped",
    });
  });

  it("folds a proposed ADR into in-progress", () => {
    expect(parseDocStatus(frontmatter("proposed"), "adr")).toEqual({
      status: "in-progress",
    });
  });

  it("folds a superseded ADR into retired", () => {
    expect(parseDocStatus(frontmatter("superseded"), "adr").status).toBe(
      "retired",
    );
  });

  it("keeps a retired ADR as retired", () => {
    expect(parseDocStatus(frontmatter("retired"), "adr").status).toBe(
      "retired",
    );
  });

  it("only reads the status key inside the frontmatter block", () => {
    const body = [
      "---",
      "adr_number: 1",
      "---",
      "",
      "status: accepted in prose",
    ].join("\n");

    expect(parseDocStatus(body, "adr")).toEqual({ status: null });
  });
});

describe("statusTier", () => {
  it("skips rejected and retired", () => {
    expect(statusTier("rejected")).toBe("skip");
    expect(statusTier("retired")).toBe("skip");
  });

  it("warns on shipped", () => {
    expect(statusTier("shipped")).toBe("warn");
  });

  it("warns on draft, in-progress, and unknown", () => {
    expect(statusTier("draft")).toBe("warn");
    expect(statusTier("in-progress")).toBe("warn");
    expect(statusTier(null)).toBe("warn");
  });
});

describe("rewriteSpecStatusRow", () => {
  const spec = (status: string) =>
    [
      "# Feature Specification: Example",
      "",
      "| Field    | Value       |",
      "|----------|-------------|",
      "| Feature  | Example     |",
      `| Status   | ${status}   |`,
      "| Created  | 2026-07-14  |",
      "",
      "## Body",
      "",
      "Prose here.",
    ].join("\n");

  it("flips a Draft status to Implemented", () => {
    const out = rewriteSpecStatusRow(spec("Draft"), "Implemented");

    expect(out).not.toBeNull();
    expect(parseDocStatus(out as string, "spec").status).toBe("shipped");
    expect(out).toContain("| Status   | Implemented");
  });

  it("flips a bold **Draft** status", () => {
    const out = rewriteSpecStatusRow(spec("**Draft**"), "Implemented");

    expect(parseDocStatus(out as string, "spec").status).toBe("shipped");
  });

  it("flips In Progress to Implemented", () => {
    const out = rewriteSpecStatusRow(spec("In Progress"), "Implemented");

    expect(parseDocStatus(out as string, "spec").status).toBe("shipped");
  });

  it("returns null when the status already buckets to shipped", () => {
    expect(rewriteSpecStatusRow(spec("Implemented"), "Implemented")).toBeNull();
    expect(rewriteSpecStatusRow(spec("Shipped"), "Implemented")).toBeNull();
    expect(rewriteSpecStatusRow(spec("Accepted"), "Implemented")).toBeNull();
  });

  it("returns null for a retired spec so it is not re-marked", () => {
    expect(rewriteSpecStatusRow(spec("Superseded"), "Implemented")).toBeNull();
    expect(rewriteSpecStatusRow(spec("Retired"), "Implemented")).toBeNull();
  });

  it("returns null when there is no Status row", () => {
    expect(
      rewriteSpecStatusRow("# Spec\n\nNo table.\n", "Implemented"),
    ).toBeNull();
  });

  it("demotes a Shipped status when allowTerminal is set", () => {
    const out = rewriteSpecStatusRow(spec("Shipped"), "In Progress", {
      allowTerminal: true,
    });

    expect(parseDocStatus(out as string, "spec").status).toBe("in-progress");
    expect(out).toContain("| Status   | In Progress");
  });

  it("demotes a Retired status when allowTerminal is set", () => {
    const out = rewriteSpecStatusRow(spec("Retired"), "Draft", {
      allowTerminal: true,
    });

    expect(parseDocStatus(out as string, "spec").status).toBe("draft");
  });

  it("returns null with allowTerminal set when there is no Status row", () => {
    expect(
      rewriteSpecStatusRow("# Spec\n\nNo table.\n", "Draft", {
        allowTerminal: true,
      }),
    ).toBeNull();
  });

  it("preserves CRLF line endings when the source uses them", () => {
    const crlf = spec("Draft").replace(/\n/g, "\r\n");
    const out = rewriteSpecStatusRow(crlf, "Implemented") as string;

    expect(out.includes("\r\n")).toBe(true);
    expect(out.includes("\n\n")).toBe(false);
    expect(parseDocStatus(out, "spec").status).toBe("shipped");
  });

  it("leaves every other line untouched", () => {
    const before = spec("Draft");
    const after = rewriteSpecStatusRow(before, "Implemented") as string;
    const changed = before
      .split("\n")
      .filter((line, i) => line !== after.split("\n")[i]);

    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("Status");
  });
});

describe("rewriteAdrStatusRow", () => {
  const adr = (status: string) =>
    [
      "---",
      'adr_number: "007"',
      "title: Replace Klaus with a purpose-built agent",
      `status: ${status}`,
      "date: 2026-03-29",
      "domains:",
      "  - architecture",
      "---",
      "",
      "# ADR-007: Replace Klaus",
      "",
      "Prose here.",
    ].join("\n");

  it("flips a shipped ADR to draft", () => {
    const out = rewriteAdrStatusRow(adr("shipped"), "draft");

    expect(parseDocStatus(out as string, "adr").status).toBe("draft");
    expect(out).toContain("status: draft");
  });

  it("flips an in progress ADR to draft", () => {
    const out = rewriteAdrStatusRow(adr("in progress"), "draft");

    expect(parseDocStatus(out as string, "adr").status).toBe("draft");
  });

  it("flips a quoted status value", () => {
    const out = rewriteAdrStatusRow(adr('"shipped"'), "in progress");

    expect(parseDocStatus(out as string, "adr").status).toBe("in-progress");
  });

  it("returns null when the ADR has no frontmatter", () => {
    expect(
      rewriteAdrStatusRow("# ADR-36\n\nNo frontmatter.\n", "draft"),
    ).toBeNull();
  });

  it("returns null when the frontmatter has no status key", () => {
    const noStatus = ["---", 'adr_number: "036"', "---", "", "# ADR-36"].join(
      "\n",
    );

    expect(rewriteAdrStatusRow(noStatus, "draft")).toBeNull();
  });

  it("only rewrites the status key inside the frontmatter block", () => {
    const withBodyStatus = `${adr("shipped")}\n\nstatus: shipped\n`;
    const out = rewriteAdrStatusRow(withBodyStatus, "draft") as string;

    expect(parseDocStatus(out, "adr").status).toBe("draft");
    expect(out.endsWith("\n\nstatus: shipped\n")).toBe(true);
  });

  it("preserves CRLF line endings when the source uses them", () => {
    const crlf = adr("shipped").replace(/\n/g, "\r\n");
    const out = rewriteAdrStatusRow(crlf, "draft") as string;

    expect(out.includes("\r\n")).toBe(true);
    expect(out.includes("\n\n")).toBe(false);
    expect(parseDocStatus(out, "adr").status).toBe("draft");
  });

  it("leaves every other line untouched", () => {
    const before = adr("shipped");
    const after = rewriteAdrStatusRow(before, "draft") as string;
    const changed = before
      .split("\n")
      .filter((line, i) => line !== after.split("\n")[i]);

    expect(changed).toEqual(["status: shipped"]);
  });
});
