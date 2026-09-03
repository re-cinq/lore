import { describe, it, expect } from "vitest";
import { renderEscalationBody } from "./escalation-body.js";

describe("renderEscalationBody", () => {
  it("includes branch link, commit log link, diagnostic", () => {
    const body = renderEscalationBody({
      taskId: "t-1",
      repo: "owner/repo",
      branchName: "lore/feature/x",
      reason: "iteration_max_exceeded",
      diagnostic: "Review went 3 rounds without convergence",
    });

    expect(body).toContain("**Task ID:** `t-1`");
    expect(body).toContain(
      "(https://github.com/owner/repo/tree/lore%2Ffeature%2Fx)",
    );
    expect(body).toContain(
      "(https://github.com/owner/repo/commits/lore%2Ffeature%2Fx)",
    );
    expect(body).toContain("`iteration_max_exceeded`");
    expect(body).toContain("Review went 3 rounds without convergence");
  });

  it("includes failing phase output and contributing refs when provided", () => {
    const body = renderEscalationBody({
      taskId: "t-1",
      repo: "owner/repo",
      branchName: "b",
      reason: "validation_failed_twice",
      diagnostic: "lint failed twice",
      failingPhaseOutput: "ERROR: ‘x’ is not defined\nERROR: ...",
      contributingRefs: [
        { type: "fact", id: "f-1", text: "Use ESLint v9" },
        { type: "memory", id: "m-2" },
      ],
    });

    expect(body).toContain("### Failing phase output");
    expect(body).toContain("ERROR: ‘x’ is not defined");
    expect(body).toContain("- fact `f-1`: Use ESLint v9");
    expect(body).toContain("- memory `m-2`");
  });
});
