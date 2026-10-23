import { describe, it, expect } from "vitest";
import * as recipePrompt from "./recipe-prompt.js";

const appendRuntimeContext = (recipePrompt as any).appendRuntimeContext as (
  basePrompt: string,
  args: {
    reported_changes?: boolean;
    previous_round_report?: { done?: string; next?: string };
    ci_verdict?: {
      judged_sha: string;
      failed_checks: Array<{
        name: string;
        failed_step?: string;
        step_log?: string;
        npm_script?: { package: string; script: string };
      }>;
    };
    [key: string]: any;
  },
) => string;

describe("appendRuntimeContext", () => {
  it("Statement 275: appends it to the prompt as a block of its own, which stays last. ([validated by appending failed step vs bare check](specs/implementation-loop/spec.md#L275))", () => {
    const result = appendRuntimeContext("Base prompt", {
      reported_changes: true,
      ci_verdict: {
        judged_sha: "abc1234",
        failed_checks: [
          {
            name: "test",
            failed_step: "npm run test:coverage",
          },
        ],
      },
    });

    expect(result).toContain("Base prompt");
    expect(result).toContain("run only a failed step's command");
    expect(result).toContain("npm run test:coverage");
  });

  it("Statement 278: tells the next pod to run only a failed step's command when the report names one, and a job's whole command only when it names a bare check. ([validated by formatting bare jobs](specs/implementation-loop/spec.md#L278))", () => {
    const result = appendRuntimeContext("Base prompt", {
      reported_changes: true,
      ci_verdict: {
        judged_sha: "abc1234",
        failed_checks: [{ name: "lint" }],
      },
    });

    expect(result).toContain("a job's whole command");
  });

  it("Statement 277: appends them to the next agent prompt as ## The previous round reported, before the CI verdict, which stays last. ([validated by appending previous round report before CI verdict](specs/implementation-loop/spec.md#L277))", () => {
    const result = appendRuntimeContext("Base prompt", {
      reported_changes: true,
      previous_round_report: { done: "Did X", next: "Do Y" },
      ci_verdict: {
        judged_sha: "abc1234",
        failed_checks: [{ name: "lint" }],
      },
    });

    const prevIndex = result.indexOf("## The previous round reported");
    const doneIndex = result.indexOf("Did X");
    const ciIndex = result.indexOf("lint");

    expect(prevIndex).toBeGreaterThan(-1);
    expect(doneIndex).toBeGreaterThan(prevIndex);
    expect(ciIndex).toBeGreaterThan(doneIndex);
  });

  it("Statement 282: renders only when the visit that routed here reported changes AND the args name a failed check. ([validated by rendering only on reported changes and failed check](specs/implementation-loop/spec.md#L282))", () => {
    const noChangesResult = appendRuntimeContext("Base prompt", {
      reported_changes: false,
      ci_verdict: {
        judged_sha: "abc1234",
        failed_checks: [{ name: "lint" }],
      },
    });

    expect(noChangesResult).toBe("Base prompt");

    const noChecksResult = appendRuntimeContext("Base prompt", {
      reported_changes: true,
      ci_verdict: {
        judged_sha: "abc1234",
        failed_checks: [],
      },
    });

    expect(noChecksResult).toBe("Base prompt");
  });
});
