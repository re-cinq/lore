import { describe, it, expect } from "vitest";
import { LORE_BLOCKED_LABEL } from "@re-cinq/lore-shared";
import { decideBranchResume } from "./resume-branch.js";

const base = {
  branchExists: true,
  issueLabels: [] as readonly string[],
  openPr: null,
};

describe("decideBranchResume", () => {
  it("starts fresh when the branch is gone — the owner's restart lever", () => {
    expect(decideBranchResume({ ...base, branchExists: false })).toEqual({
      resume: false,
    });
  });

  it("starts fresh when the branch cannot be read, treating optional-port undefined as unknown rather than resuming on a guess", () => {
    expect(decideBranchResume({ ...base, branchExists: undefined })).toEqual({
      resume: false,
    });
  });

  it("starts fresh on a blocked ticket, so a human's block is not silently undone", () => {
    expect(
      decideBranchResume({ ...base, issueLabels: [LORE_BLOCKED_LABEL] }),
    ).toEqual({ resume: false });
  });

  it("resumes a clean branch with no pull request yet", () => {
    expect(decideBranchResume(base)).toEqual({
      resume: true,
      lineArgs: { resumed_from_branch: true },
    });
  });

  it("seeds pr_number and pr_url so the parked node's route resolves", () => {
    expect(
      decideBranchResume({
        ...base,
        openPr: { number: 77, url: "https://github.com/re-cinq/lore/pull/77" },
      }),
    ).toEqual({
      resume: true,
      lineArgs: {
        resumed_from_branch: true,
        pr_number: 77,
        pr_url: "https://github.com/re-cinq/lore/pull/77",
      },
    });
  });
});
