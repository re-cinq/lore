import { describe, it, expect } from "vitest";
import {
  budgetSkipBody,
  buildReviewSummary,
  REVIEW_HELP,
} from "./review-summary.js";
import type { ReviewOutput } from "./review-findings.js";

describe("buildReviewSummary", () => {
  it("renders the Approved header and a zero tally for no findings", () => {
    const output: ReviewOutput = { verdict: "approved", findings: [] };

    expect(buildReviewSummary(output)).toBe(
      `### Lore review — Approved\n\nMust fix (0) · Consider (0) · Nits (0)\n\n${REVIEW_HELP}`,
    );
  });

  it("counts blocking issues as must-fix, nits, and the rest as consider", () => {
    const output: ReviewOutput = {
      verdict: "changes_requested",
      findings: [
        {
          path: "a.ts",
          line: 1,
          label: "issue",
          decoration: "blocking",
          subject: "x",
        },
        { path: "a.ts", line: 2, label: "suggestion", subject: "y" },
        { path: "a.ts", line: 3, label: "question", subject: "z" },
        { path: "a.ts", line: 4, label: "nit", subject: "w" },
        { path: "a.ts", line: 5, label: "praise", subject: "nice" },
      ],
    };

    expect(buildReviewSummary(output)).toContain(
      "Must fix (1) · Consider (2) · Nits (1)",
    );
  });

  it("includes the agent summary line under the header when present", () => {
    const output: ReviewOutput = {
      verdict: "changes_requested",
      summary: "one null-deref risk",
      findings: [],
    };

    expect(buildReviewSummary(output)).toBe(
      `### Lore review — Changes suggested\n\none null-deref risk\n\nMust fix (0) · Consider (0) · Nits (0)\n\n${REVIEW_HELP}`,
    );
  });
});

describe("buildReviewSummary model disclosure", () => {
  it("names the reviewing model in the body when given one", () => {
    const summary = buildReviewSummary(
      { verdict: "approved", findings: [], summary: "No issues found." },
      { model: "gemini-3.1-pro-preview" },
    );

    expect(summary).toContain("_Reviewed by `gemini-3.1-pro-preview`_");
  });

  it("omits the reviewer line when no model is known", () => {
    expect(
      buildReviewSummary({ verdict: "approved", findings: [], summary: "" }),
    ).not.toContain("Reviewed by");
  });
});

describe("budgetSkipBody", () => {
  it("approves loudly without judgment and names the reviewer that would have run", () => {
    const body = budgetSkipBody("gemini-3.1-pro-preview");

    expect(body).toContain("Approved without review (no LLM budget)");
    expect(body).toContain("no judgment of the diff has happened");
    expect(body).toContain(
      "_Reviewer that would have run: `gemini-3.1-pro-preview`_",
    );
  });

  it("renders without a reviewer line when the model is unknown", () => {
    expect(budgetSkipBody()).not.toContain("Reviewer that would have run");
  });
});
