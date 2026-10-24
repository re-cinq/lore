import { describe, expect, it } from "vitest";
import { roundBriefOf } from "./round-brief.js";

const RED = {
  sha: "deadbeef",
  failedChecks: "lint, test",
  summary: "src/a.ts:7 no-unused-vars",
};

describe("roundBriefOf", () => {
  it("names the sha deadbeef, the failed checks lint and test, and fences what they printed", () => {
    expect(roundBriefOf({ feedback: RED, review: null, handoff: null })).toBe(
      [
        "## CI reported failures on deadbeef",
        "",
        "The build for your last push is red. These checks failed: lint, test",
        "",
        "Where a failed step is named below, run only that step's command; otherwise map each name to the job that publishes it and run only that job's command.",
        "",
        "```",
        "src/a.ts:7 no-unused-vars",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("leaves the fence out when the jobs printed nothing", () => {
    expect(
      roundBriefOf({ feedback: { ...RED, summary: "" }, review: null, handoff: null }),
    ).not.toContain("```");
  });

  it("cuts what the jobs printed at 2500 characters and says so", () => {
    const brief = roundBriefOf({
      feedback: { ...RED, summary: "x".repeat(3000) },
      review: null,
      handoff: null,
    });

    expect(brief).toContain(`${"x".repeat(2500)}\n...(truncated)`);
    expect(brief).not.toContain("x".repeat(2501));
  });

  it("adds what the previous round reported it did and what it left for next", () => {
    expect(
      roundBriefOf({
        feedback: RED,
        review: null,
        handoff: { done: "parses the header", next: "reject an empty body" },
      }),
    ).toContain(
      "## The previous round reported\n\n- Done: parses the header\n- Next: reject an empty body\n",
    );
  });

  it("names Lore's review of cafe1234 and gives its findings as Lore wrote them", () => {
    expect(
      roundBriefOf({
        feedback: null,
        review: {
          sha: "cafe1234",
          findings: "- inline comment 11 on src/a.ts:4: the null check is inverted",
        },
        handoff: null,
      }),
    ).toBe(
      [
        "## Lore's review asked for changes on cafe1234",
        "",
        "Make the changes these findings ask for, and only those. A finding you judge wrong is left as it is, with the reason in your report.",
        "",
        "- inline comment 11 on src/a.ts:4: the null check is inverted",
        "",
      ].join("\n"),
    );
  });
});
