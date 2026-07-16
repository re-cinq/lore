import { describe, it, expect } from "vitest";
import { parseDocStatus, statusTier } from "./spec-status.js";

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

  it("buckets an In Progress spec as in-progress", () => {
    expect(parseDocStatus(table("In Progress"), "spec").status).toBe(
      "in-progress",
    );
  });

  it("buckets Rejected as rejected", () => {
    expect(parseDocStatus(table("Rejected (2026-06-17)"), "spec")).toEqual({
      status: "rejected",
    });
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

  it("folds a superseded ADR into rejected", () => {
    expect(parseDocStatus(frontmatter("superseded"), "adr").status).toBe(
      "rejected",
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
  it("skips rejected", () => {
    expect(statusTier("rejected")).toBe("skip");
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
