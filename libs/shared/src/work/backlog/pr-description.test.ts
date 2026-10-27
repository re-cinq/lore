import { describe, expect, it } from "vitest";
import {
  describedPull,
  prDescriptionPrompt,
  templateHeadings,
} from "./pr-description.js";

describe("templateHeadings", () => {
  it("reads the ## headings of the repository's pull request template, and Why, What Changed and Testing without one", () => {
    expect([
      templateHeadings("## Summary\nText\n## Risk\n### Not this\n"),
      templateHeadings(null),
      templateHeadings("No headings here"),
    ]).toEqual([
      ["Summary", "Risk"],
      ["Why", "What Changed", "Testing"],
      ["Why", "What Changed", "Testing"],
    ]);
  });
});

describe("prDescriptionPrompt", () => {
  it("hands the model the ticket, the definition of done, the headings and the diff, the diff cut at 60,000 characters", () => {
    const prompt = prDescriptionPrompt({
      ticket: "# Add export (#7)",
      dod: "Done when export.test.ts passes",
      headings: ["Why", "Testing"],
      diff: `+${"x".repeat(70_000)}`,
    });

    expect({
      ticket: prompt.includes("# Add export (#7)"),
      dod: prompt.includes("Done when export.test.ts passes"),
      headings: prompt.includes("`## Why`, `## Testing`"),
      cut: prompt.length < 62_000,
    }).toEqual({ ticket: true, dod: true, headings: true, cut: true });
  });
});

describe("describedPull", () => {
  it("keeps the title under 70 characters on one line, and reads coverage as partial only when the model says so", () => {
    expect([
      describedPull({
        title: `Add the export button\n${"and more ".repeat(20)}`,
        body: "## Why\nBecause.",
        issue_coverage: "partial",
      }),
      describedPull({
        title: "Add export",
        body: "## Why\nB.",
        issue_coverage: "maybe",
      }),
    ]).toEqual([
      {
        title: "Add the export button",
        body: "## Why\nBecause.",
        coverage: "partial",
      },
      { title: "Add export", body: "## Why\nB.", coverage: "full" },
    ]);
  });

  it("ends a first line over 70 characters with an ellipsis, as mark-ready clamps every title", () => {
    expect(
      describedPull({
        title: "x".repeat(80),
        body: "## Why\nB.",
        issue_coverage: "full",
      })?.title,
    ).toBe(`${"x".repeat(69)}…`);
  });

  it("is null for an answer with no title or no body, so the step fails and runs once more", () => {
    expect([
      describedPull({ title: " ", body: "## Why", issue_coverage: "full" }),
      describedPull({ title: "Add export", body: "", issue_coverage: "full" }),
    ]).toEqual([null, null]);
  });
});
