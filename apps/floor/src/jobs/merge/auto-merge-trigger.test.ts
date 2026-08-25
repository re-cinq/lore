import { describe, it, expect, vi, beforeEach } from "vitest";

const getByIdMock = vi.fn();
const rawSettingsMock = vi.fn();
const resolvePrForTaskFromDbMock = vi.fn();

vi.mock("../../kernel/queues.js", () => ({
  // The logs route resolves the cluster agent from here.
  clusterAgent: () => ({}),
  taskStore: () => ({ getById: (...args: unknown[]) => getByIdMock(...args) }),
  settings: () => ({
    rawSettings: (...args: unknown[]) => rawSettingsMock(...args),
  }),
}));

vi.mock("./pr-policy.js", () => ({
  resolvePrForTaskFromDb: (...args: unknown[]) =>
    resolvePrForTaskFromDbMock(...args),
}));

const evaluateAndMergeMock = vi.fn();

vi.mock("./auto-merge.js", async (orig) => {
  const actual = await orig<typeof import("./auto-merge.js")>();

  return {
    ...actual,
    evaluateAndMerge: (...args: unknown[]) => evaluateAndMergeMock(...args),
  };
});

const { tryAutoMergeForCompletedTask } =
  await import("./auto-merge-trigger.js");

/** Seed the task record + repo settings the trigger reads, mirroring the old
 *  joined `{ target_repo, settings }` row shape per case. */
function seedTask(targetRepo: string | null, settings: unknown): void {
  getByIdMock.mockResolvedValueOnce(
    targetRepo ? { target_repo: targetRepo } : null,
  );
  rawSettingsMock.mockResolvedValueOnce(settings);
}

beforeEach(() => {
  getByIdMock.mockReset();
  rawSettingsMock.mockReset();
  resolvePrForTaskFromDbMock.mockReset();
  evaluateAndMergeMock.mockReset();
});

describe("tryAutoMergeForCompletedTask", () => {
  it("returns null when the task has no target_repo (orphaned task)", async () => {
    seedTask(null, null);
    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });

    expect(result).toBeNull();
    expect(evaluateAndMergeMock).not.toHaveBeenCalled();
  });

  it("returns null when dark_factory.enabled is false (no audit row written)", async () => {
    seedTask("owner/repo", { dark_factory: { enabled: false } });
    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });

    expect(result).toBeNull();
    expect(resolvePrForTaskFromDbMock).not.toHaveBeenCalled();
    expect(evaluateAndMergeMock).not.toHaveBeenCalled();
  });

  it("returns null when settings is null (legacy repo without dark mode)", async () => {
    seedTask("owner/repo", null);
    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });

    expect(result).toBeNull();
    expect(evaluateAndMergeMock).not.toHaveBeenCalled();
  });

  it("returns null when pr-policy returns null (PR not yet created)", async () => {
    seedTask("owner/repo", { dark_factory: { enabled: true } });

    resolvePrForTaskFromDbMock.mockResolvedValueOnce(null);

    const result = await tryAutoMergeForCompletedTask({ taskId: "t1" });

    expect(result).toBeNull();
    expect(evaluateAndMergeMock).not.toHaveBeenCalled();
  });

  it("calls evaluateAndMerge with the resolved policy when dark mode is on + PR exists", async () => {
    seedTask("owner/repo", { dark_factory: { enabled: true } });

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
      taskId: "t1",
      repo: "owner/repo",
      prNumber: 42,
      policy,
    });
  });

  it("resolves the PR through the facade-backed policy lookup (no octokit)", async () => {
    seedTask("owner/repo", { dark_factory: { enabled: true } });
    resolvePrForTaskFromDbMock.mockResolvedValueOnce(null);
    await tryAutoMergeForCompletedTask({ taskId: "t1" });
    expect(resolvePrForTaskFromDbMock).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ enabled: true }),
    );
  });

  it("propagates errors from evaluateAndMerge to the caller", async () => {
    // The watcher's outer .catch() handles the error and logs it
    // (loretask-watcher.ts), so the trigger doesn't need its own
    // try/catch. This test locks in that contract — if anyone adds
    // an internal try/catch, this fails and forces them to update
    // the watcher's expectations too.
    seedTask("owner/repo", { dark_factory: { enabled: true } });

    resolvePrForTaskFromDbMock.mockResolvedValueOnce({
      repo: "owner/repo",
      prNumber: 7,
      policy: {
        darkFactoryEnabled: true,
        autoMerge: {
          paths: [],
          min_trust: "docs" as const,
          require_green_ci: true,
          require_bot_approval: true,
        },
        trustLevel: "docs" as const,
        changedPaths: [],
        ciSucceeded: true,
        botApproved: true,
        humanChangesRequested: false,
      },
    });
    evaluateAndMergeMock.mockRejectedValueOnce(new Error("merge api 502"));

    await expect(
      tryAutoMergeForCompletedTask({ taskId: "t1" }),
    ).rejects.toThrow("merge api 502");
  });
});
