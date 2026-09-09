import { describe, it, expect } from "vitest";
import { ciFeedbackOf, withCiFeedback } from "./ci-feedback.js";

const redArgs = {
  ci_feedback_sha: "deadbeef",
  ci_failed_checks: "lint, test:shared",
  ci_failure_summary: "### lint (failure)\n\nno-unused-vars",
};

const afterRedCi = [
  { nodeId: "tdd-round", outcome: "success" },
  { nodeId: "await-ci", outcome: "changes_requested" },
];

describe("ciFeedbackOf", () => {
  it("reads the feedback when the visit that routed here reported changes", () => {
    expect(ciFeedbackOf(afterRedCi, redArgs)).toEqual({
      sha: "deadbeef",
      failedChecks: "lint, test:shared",
      summary: "### lint (failure)\n\nno-unused-vars",
    });
  });

  it("returns null when the visit that routed here succeeded", () => {
    expect(
      ciFeedbackOf([{ nodeId: "await-ci", outcome: "success" }], redArgs),
    ).toBe(null);
  });

  it("returns null when the args name no failed check", () => {
    expect(ciFeedbackOf(afterRedCi, { ci_failed_checks: "" })).toBe(null);
  });

  it("returns null when the run carries no CI args at all", () => {
    expect(ciFeedbackOf(afterRedCi, {})).toBe(null);
  });

  it("reads the last recorded visit, not the open row of the node being launched", () => {
    expect(
      ciFeedbackOf(
        [...afterRedCi, { nodeId: "tdd-round", outcome: null }],
        redArgs,
      ),
    ).toMatchObject({ sha: "deadbeef" });
  });
});

describe("withCiFeedback", () => {
  it("leaves the prompt untouched when there is no feedback", () => {
    expect(withCiFeedback("Do the work.", null)).toBe("Do the work.");
  });

  it("cuts a summary past the cap, because the args it renders are external input", () => {
    expect(
      withCiFeedback("Do the work.", {
        sha: "deadbeef",
        failedChecks: "lint",
        summary: "x".repeat(3000),
      }),
    ).toContain(`${"x".repeat(2500)}\n...(truncated)`);
  });

  it("appends the failed check names and what those jobs reported", () => {
    expect(
      withCiFeedback("Do the work.", {
        sha: "deadbeef",
        failedChecks: "lint",
        summary: "### lint (failure)\n\nno-unused-vars",
      }),
    ).toBe(
      `Do the work.

## CI reported failures on deadbeef

The build for your last push is red. These checks failed: lint

Map each name to the job that publishes it and run only that job's command.

\`\`\`
### lint (failure)

no-unused-vars
\`\`\`
`,
    );
  });
});
