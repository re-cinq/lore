// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Llm, FakeLlm } from "@re-cinq/lore-shared";

// handleFeatureRequest drives the repo/pulls facades via projectFor(repo)
// and the Llm singleton — the fake Project's facades are the spies, FakeLlm
// supplies the canned spec content. Same fake-and-mock pattern as
// worker.onboard.test.ts.
const fakeRepo = {
  createBranch: vi.fn(),
  commitFile: vi.fn(),
  isConfigured: vi.fn(() => true),
  defaultBranch: vi.fn(),
};
const fakePulls = { open: vi.fn() };
const fakeIssues = { create: vi.fn(), comment: vi.fn(), addLabel: vi.fn(), close: vi.fn() };
const fakeProject = { repo: fakeRepo, pulls: fakePulls, issues: fakeIssues };

const fetchRepoContext = vi.fn();
const query = vi.fn();
const writeEpisode = vi.fn();

vi.mock("../../platform/project-boot.js", () => ({ projectFor: async () => fakeProject }));
vi.mock("./repo-context.js", () => ({ fetchRepoContext: (...a: unknown[]) => fetchRepoContext(...a) }));
vi.mock("../../platform/db.js", () => ({
  query: (...a: unknown[]) => query(...a),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));
vi.mock("../../lib/episode-writer.js", () => ({ writeEpisode: (...a: unknown[]) => writeEpisode(...a) }));

import { handleFeatureRequest } from "./handle-feature-request.js";

beforeEach(() => {
  for (const fn of [...Object.values(fakeRepo), ...Object.values(fakePulls), ...Object.values(fakeIssues)]) fn.mockReset();
  fetchRepoContext.mockReset();
  query.mockReset();
  writeEpisode.mockReset();

  fetchRepoContext.mockResolvedValue({ tree: [], files: {} });
  query.mockResolvedValue([]);
  writeEpisode.mockResolvedValue(undefined);
  fakeRepo.createBranch.mockResolvedValue(undefined);
  fakeRepo.commitFile.mockResolvedValue(undefined);
  fakeRepo.isConfigured.mockReturnValue(true);
  fakePulls.open.mockResolvedValue({ repo: "re-cinq/app", number: 7, title: "", branch: "lore/spec", state: "open", labels: [], url: "https://gh/pr/7" });
});

describe("handleFeatureRequest", () => {
  it("commits the three spec artifacts then opens the PR", async () => {
    Llm.setInstance(new FakeLlm({ text: "Real spec content that is longer than twenty chars." }));

    await handleFeatureRequest({ id: "task-1", description: "Add health checks" }, "re-cinq/app", "lore/spec", undefined, null);

    expect(fakeRepo.createBranch).toHaveBeenCalledWith("lore/spec");
    expect(fakeRepo.commitFile).toHaveBeenCalledTimes(3);
    expect(fakePulls.open).toHaveBeenCalledTimes(1);
    const lastCommit = Math.max(...fakeRepo.commitFile.mock.invocationCallOrder);
    expect(lastCommit).toBeLessThan(fakePulls.open.mock.invocationCallOrder[0]);
  });

  it("throws when every artifact is SKIP and opens no PR", async () => {
    Llm.setInstance(new FakeLlm({ text: "SKIP" }));

    await expect(
      handleFeatureRequest({ id: "task-1", description: "Add health checks" }, "re-cinq/app", "lore/spec", undefined, null),
    ).rejects.toThrow(new Error("Failed to generate any spec artifacts"));

    expect(fakeRepo.commitFile).not.toHaveBeenCalled();
    expect(fakePulls.open).not.toHaveBeenCalled();
  });
});
