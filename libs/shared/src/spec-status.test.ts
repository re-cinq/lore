import { describe, it, expect } from "vitest";
import { parseDocStatus } from "./spec-status.js";

describe("parseDocStatus (spec)", () => {
  const table = (status: string) =>
    ["| Field | Value |", "|---|---|", `| Status | ${status} |`, ""].join("\n");

  it("returns finalized for a Shipped spec", () => {
    expect(parseDocStatus(table("Shipped"), "spec")).toEqual({
      status: "shipped",
      isFinalized: true,
    });
  });

  it("folds Implemented / Complete / Accepted / Done / Live into the finalized bucket", () => {
    for (const value of [
      "Implemented",
      "Complete",
      "Accepted",
      "Done",
      "Live",
    ]) {
      expect(parseDocStatus(table(value), "spec").isFinalized).toBe(true);
    }
  });

  it("strips bold markers and trailing prose before bucketing", () => {
    expect(parseDocStatus(table("**Shipped**"), "spec").isFinalized).toBe(true);
    expect(
      parseDocStatus(table("Shipped (v3) — supersedes v1 and v2"), "spec")
        .isFinalized,
    ).toBe(true);
  });

  it("returns not-finalized for a Draft spec", () => {
    expect(parseDocStatus(table("**Draft**"), "spec")).toEqual({
      status: "draft",
      isFinalized: false,
    });
  });

  it("returns not-finalized for Rejected", () => {
    expect(parseDocStatus(table("Rejected (2026-06-17)"), "spec")).toEqual({
      status: "rejected",
      isFinalized: false,
    });
  });

  it("returns null status when no Status row is present", () => {
    expect(parseDocStatus("# Spec\n\nNo table here.\n", "spec")).toEqual({
      status: null,
      isFinalized: false,
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

  it("returns finalized for an accepted ADR", () => {
    expect(parseDocStatus(frontmatter("accepted"), "adr")).toEqual({
      status: "accepted",
      isFinalized: true,
    });
  });

  it("returns not-finalized for a proposed ADR", () => {
    expect(parseDocStatus(frontmatter("proposed"), "adr")).toEqual({
      status: "proposed",
      isFinalized: false,
    });
  });

  it("returns not-finalized for a superseded ADR", () => {
    expect(parseDocStatus(frontmatter("superseded"), "adr").isFinalized).toBe(
      false,
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

    expect(parseDocStatus(body, "adr")).toEqual({
      status: null,
      isFinalized: false,
    });
  });
});
