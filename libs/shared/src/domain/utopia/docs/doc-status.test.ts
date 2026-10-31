import { describe, it, expect } from "vitest";
import { docMarks, markLines } from "./doc-status.js";

describe("docMarks", () => {
  it("reads accepted from an ADR's frontmatter status: accepted", () => {
    expect(
      docMarks(
        "---\nadr_number: 49\nstatus: accepted\ndate: 2026-10-01\n---\n\n# ADR-049\n",
      ),
    ).toEqual({ status: "accepted", amended: null });
  });

  it("reads superseded by ADR-048 from status: superseded and superseded_by: 48", () => {
    expect(
      docMarks(
        "---\nadr_number: 37\nstatus: superseded\nsuperseded_by: 48\n---\n",
      ),
    ).toEqual({ status: "superseded by ADR-048", amended: null });
  });

  it("reads shipped from the spec row | Status | Shipped |", () => {
    expect(docMarks("| Status  | Shipped   |\n| Owner | x |\n").status).toEqual(
      "shipped",
    );
  });

  it("reads accepted from the first line of a ## Status section", () => {
    expect(
      docMarks("# ADR\n\n## Status\n\nAccepted\n\n## Context\n").status,
    ).toEqual("accepted");
  });

  it("reads draft from a - **Status**: Draft line", () => {
    expect(docMarks("- **Status**: Draft\n").status).toEqual("draft");
  });

  it("reads proposed from a bare Status: Proposed line", () => {
    expect(docMarks("Status: Proposed\n").status).toEqual("proposed");
  });

  it("takes 2026-10-31 as newest of the heading 2026-10-02 and the markers 2026-10-19 and 2026-10-31", () => {
    expect(
      docMarks(
        "## Amendment 2026-10-02: the mode is removed\n\n*(2026-10-19)* a\n\n- FR1 *(added 2026-10-31)* b\n",
      ).amended,
    ).toEqual("2026-10-31");
  });

  it("reads the date of a parenthesised heading ## Amendment (2026-06-29): generalized", () => {
    expect(
      docMarks("## Amendment (2026-06-29): generalized\n").amended,
    ).toEqual("2026-06-29");
  });

  it("finds neither status nor amendment in a plain README", () => {
    expect(docMarks("# Readme\n\nHello.\n")).toEqual({
      status: null,
      amended: null,
    });
  });
});

describe("markLines", () => {
  it("lists Status then Amended lines and none when both are null", () => {
    expect([
      markLines({ status: "accepted", amended: "2026-10-31" }),
      markLines({ status: null, amended: null }),
    ]).toEqual([["Status: accepted", "Amended: 2026-10-31"], []]);
  });
});
