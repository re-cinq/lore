import { describe, it, expect } from "vitest";
import {
  parseOnboardingPrUrl,
  describeFlipSuccess,
  describeFlipMiss,
} from "./merge-check.js";

describe("parseOnboardingPrUrl", () => {
  it("reads owner, repo, and PR number from a github.com pull URL", () => {
    expect(
      parseOnboardingPrUrl("https://github.com/acme/widgets/pull/42"),
    ).toEqual({ owner: "acme", repoName: "widgets", number: 42 });
  });

  it("returns null for a URL that carries no pull request", () => {
    expect(parseOnboardingPrUrl("https://github.com/acme/widgets")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseOnboardingPrUrl("")).toBeNull();
  });
});

describe("describeFlipSuccess", () => {
  it("names the PR when the flip opened one", () => {
    expect(
      describeFlipSuccess("specs/x/spec.md", {
        prUrl: "https://example.test/pr/9",
        skipped: false,
      }),
    ).toBe(
      "[job] merge-check: spec-status-upkeep marked specs/x/spec.md implemented (https://example.test/pr/9)",
    );
  });

  it("says already current when the flip was skipped as current", () => {
    expect(
      describeFlipSuccess("specs/x/spec.md", { prUrl: null, skipped: true }),
    ).toBe(
      "[job] merge-check: spec-status-upkeep marked specs/x/spec.md implemented (already current)",
    );
  });
});

describe("describeFlipMiss", () => {
  it("reports status and reason with no PR when none was opened", () => {
    expect(
      describeFlipMiss(
        "specs/x/spec.md",
        {
          prUrl: null,
          reason: "no-coverage-tier",
          status: "shipped",
        },
        "f1",
      ),
    ).toBe(
      "[job] merge-check: spec-status-upkeep did not mark specs/x/spec.md shipped " +
        "(status=shipped, reason=no-coverage-tier); feature f1 left for human reconcile",
    );
  });

  it("defaults status and reason to placeholders when the result carries neither", () => {
    expect(describeFlipMiss("specs/x/spec.md", { prUrl: null }, "f1")).toBe(
      "[job] merge-check: spec-status-upkeep did not mark specs/x/spec.md shipped " +
        "(status=unreadable, reason=flipped); feature f1 left for human reconcile",
    );
  });

  it("appends the PR link when one was opened but did not confirm shipped", () => {
    expect(
      describeFlipMiss(
        "specs/x/spec.md",
        {
          prUrl: "https://example.test/pr/9",
          status: "in-progress",
        },
        "f1",
      ),
    ).toBe(
      "[job] merge-check: spec-status-upkeep did not mark specs/x/spec.md shipped " +
        "(status=in-progress, reason=flipped, pr=https://example.test/pr/9); feature f1 left for human reconcile",
    );
  });
});
