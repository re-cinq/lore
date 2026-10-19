import { describe, expect, it } from "vitest";
import { roundBriefOf } from "./round-brief.js";

const RED = {
  sha: "deadbeef",
  failedChecks: "lint, test",
  summary: "src/a.ts:7 no-unused-vars",
};

describe("roundBriefOf", () => {
  it("names the sha deadbeef, the failed checks lint and test, and fences what they printed", () => {
    expect(roundBriefOf({ feedback: RED, handoff: null })).toBe(
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
      roundBriefOf({ feedback: { ...RED, summary: "" }, handoff: null }),
    ).not.toContain("```");
  });

  it("cuts what the jobs printed at 2500 characters and says so", () => {
    const brief = roundBriefOf({
      feedback: { ...RED, summary: "x".repeat(3000) },
      handoff: null,
    });

    expect(brief).toContain(`${"x".repeat(2500)}\n...(truncated)`);
    expect(brief).not.toContain("x".repeat(2501));
  });

  it("adds what the previous round reported it did and what it left for next", () => {
    expect(
      roundBriefOf({
        feedback: RED,
        handoff: { done: "parses the header", next: "reject an empty body" },
      }),
    ).toContain(
      "## The previous round reported\n\n- Done: parses the header\n- Next: reject an empty body\n",
    );
  });
});
