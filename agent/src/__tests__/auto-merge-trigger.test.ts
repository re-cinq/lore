import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const buildOctokitMock = vi.fn();
const resolvePrForTaskFromDbMock = vi.fn();

vi.mock("../db.js", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("../lib/pr-policy.js", () => ({
  buildOctokit: (...args: unknown[]) => buildOctokitMock(...args),
  resolvePrForTaskFromDb: (...args: unknown[]) =>
    resolvePrForTaskFromDbMock(...args),
}));

const evaluateAndMergeMock = vi.fn();

vi.mock("../jobs/auto-merge.js", async (orig) => {
  const actual = await orig<typeof import("../jobs/auto-merge.js")>();
  return {
    ...actual,
    evaluateAndMerge: (...args: unknown[]) => evaluateAndMergeMock(...args),
  };
});

const { tryAutoMergeForCompletedTask } = await import(
  "../jobs/auto-merge-trigger.js"
);

beforeEach(() => {
  queryMock.mockReset();
  buildOctokitMock.mockReset();
  resolvePrForTaskFromDbMock.mockReset();
  evaluateAndMergeMock.mockReset();
});

describe("tryAutoMergeForCompletedTask", () => {
  it("returns null when the task has no target_repo (orphaned task)", async () => {
    queryMock.mockResolvedValueOnce([]);
    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });
    expect(result).toBeNull();
    expect(evaluateAndMergeMock).not.toHaveBeenCalled();
  });

  it("returns null when dark_factory.enabled is false (no audit row written)", async () => {
    queryMock.mockResolvedValueOnce([
      { target_repo: "owner/repo", settings: { dark_factory: { enabled: false } } },
    ]);
    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });
    expect(result).toBeNull();
    expect(buildOctokitMock).not.toHaveBeenCalled();
    expect(resolvePrForTaskFromDbMock).not.toHaveBeenCalled();
    expect(evaluateAndMergeMock).not.toHaveBeenCalled();
  });

  it("returns null when settings is null (legacy repo without dark mode)", async () => {
    queryMock.mockResolvedValueOnce([
      { target_repo: "owner/repo", settings: null },
    ]);
    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });
    expect(result).toBeNull();
    expect(evaluateAndMergeMock).not.toHaveBeenCalled();
  });

  it("returns null when pr-policy returns null (PR not yet created)", async () => {
    queryMock.mockResolvedValueOnce([
      { target_repo: "owner/repo", settings: { dark_factory: { enabled: true } } },
    ]);
    const fakeOctokit = { _id: "octo" } as never;
    buildOctokitMock.mockReturnValueOnce(fakeOctokit);
    resolvePrForTaskFromDbMock.mockResolvedValueOnce(null);

    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });
    expect(result).toBeNull();
    expect(evaluateAndMergeMock).not.toHaveBeenCalled();
  });

  it("calls evaluateAndMerge with the resolved policy when dark mode is on + PR exists", async () => {
    queryMock.mockResolvedValueOnce([
      {
        target_repo: "owner/repo",
        settings: { dark_factory: { enabled: true } },
      },
    ]);
    const fakeOctokit = { _id: "octo" } as never;
    buildOctokitMock.mockReturnValueOnce(fakeOctokit);

    const policy = {
      darkFactoryEnabled: true,
      autoMerge: {
        paths: ["specs/**"],
        min_trust: "docs" as const,
        require_green_ci: true,
        require_bot_approval: true,
      },
      trustLevel: "docs" as const,
      changedPaths: ["specs/foo.md"],
      ciSucceeded: true,
      botApproved: true,
      humanChangesRequested: false,
    };
    resolvePrForTaskFromDbMock.mockResolvedValueOnce({
      repo: "owner/repo",
      prNumber: 42,
      octokit: fakeOctokit,
      policy,
    });
    const decision = {
      outcome: "merged" as const,
      rule: {
        path_match_count: 1,
        trust_level: "docs",
        ci_status: "success" as const,
        bot_review_state: "APPROVED" as const,
        human_changes_requested: false,
      },
    };
    evaluateAndMergeMock.mockResolvedValueOnce(decision);

    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });
    expect(result).toEqual(decision);
    expect(evaluateAndMergeMock).toHaveBeenCalledWith({
      octokit: fakeOctokit,
      taskId: "t1",
      repo: "owner/repo",
      prNumber: 42,
      policy,
    });
  });

  it("uses the supplied octokit instead of building one", async () => {
    queryMock.mockResolvedValueOnce([
      {
        target_repo: "owner/repo",
        settings: { dark_factory: { enabled: true } },
      },
    ]);
    const supplied = { _id: "supplied" } as never;
    resolvePrForTaskFromDbMock.mockResolvedValueOnce(null);
    await tryAutoMergeForCompletedTask({ taskId: "t1", octokit: supplied });
    expect(buildOctokitMock).not.toHaveBeenCalled();
    expect(resolvePrForTaskFromDbMock).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ enabled: true }),
      supplied,
    );
  });
});
