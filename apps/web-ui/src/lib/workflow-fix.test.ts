import { describe, it, expect } from "vitest";
import { reposNeedingWorkflowFix } from "./workflow-fix";

const onboarded = (full_name: string) => ({
  full_name,
  onboarding_pr_merged: true,
});

describe("reposNeedingWorkflowFix", () => {
  it("offers a fix for an onboarded repo whose workflow is missing or stale, not an aligned one", () => {
    const status = new Map([
      ["o/missing", "missing" as const],
      ["o/stale", "stale" as const],
      ["o/aligned", "aligned" as const],
    ]);

    expect(
      reposNeedingWorkflowFix(
        [onboarded("o/missing"), onboarded("o/stale"), onboarded("o/aligned")],
        status,
      ),
    ).toEqual(["o/missing", "o/stale"]);
  });

  it("offers no fix for a repo whose onboarding PR has not merged, whatever its workflow status", () => {
    const status = new Map([["o/onboarding", "missing" as const]]);

    expect(
      reposNeedingWorkflowFix(
        [{ full_name: "o/onboarding", onboarding_pr_merged: false }],
        status,
      ),
    ).toEqual([]);
  });

  it("offers nothing for a repo with no status read", () => {
    expect(reposNeedingWorkflowFix([onboarded("o/unread")], new Map())).toEqual(
      [],
    );
  });
});
