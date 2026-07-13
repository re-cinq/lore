import type { PipelineTask } from "@re-cinq/lore-shared";
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
  Llm,
  FakeLlm,
} from "@re-cinq/lore-shared";

// handleOnboard now drives the repo/pulls/settings facades via projectFor(repo)
// instead of the platform() singleton — the fake Project's facades are the spies.
const fakeRepo = {
  createBranch: vi.fn(),
  commitFile: vi.fn(),
  isConfigured: vi.fn(() => true),
  defaultBranch: vi.fn(),
};
const fakePulls = { open: vi.fn() };
const fakeSettings = { setRepoVariable: vi.fn(), setRepoSecret: vi.fn() };
const fakeIssues = {
  create: vi.fn(),
  comment: vi.fn(),
  addLabel: vi.fn(),
  close: vi.fn(),
  createLabels: vi.fn(),
};
const fakeProject = {
  repo: fakeRepo,
  pulls: fakePulls,
  settings: fakeSettings,
  issues: fakeIssues,
};

const fetchRepoContext = vi.fn();
const query = vi.fn();
const writeEpisode = vi.fn();

vi.mock("../../composition/project-boot.js", () => ({
  projectFor: async () => fakeProject,
}));
vi.mock("./repo-context.js", () => ({
  fetchRepoContext: (...a: unknown[]) => fetchRepoContext(...a),
}));
vi.mock("../../kernel/db.js", () => ({
  query: (...a: unknown[]) => query(...a),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));
vi.mock("../lib/episode-writer.js", () => ({
  writeEpisode: (...a: unknown[]) => writeEpisode(...a),
}));

import { handleOnboard } from "./worker.js";

beforeEach(() => {
  for (const fn of [
    ...Object.values(fakeRepo),
    ...Object.values(fakePulls),
    ...Object.values(fakeSettings),
    ...Object.values(fakeIssues),
  ]) {
    fn.mockReset();
  }
  fetchRepoContext.mockReset();
  query.mockReset();
  writeEpisode.mockReset();

  // A repo that already has a .github/ directory — the case the old coarse
  // skip guard wrongly excluded the workflow from.
  fetchRepoContext.mockResolvedValue({ tree: [".github"], files: {} });
  Llm.setInstance(new FakeLlm({ text: "SKIP" }));
  query.mockResolvedValue({ rows: [] });
  writeEpisode.mockResolvedValue(undefined);
  fakeIssues.createLabels.mockResolvedValue(undefined);
  fakeRepo.createBranch.mockResolvedValue(undefined);
  fakeRepo.commitFile.mockResolvedValue(undefined);
  fakeRepo.isConfigured.mockReturnValue(true);
  fakePulls.open.mockResolvedValue({
    repo: "re-cinq/app",
    number: 1,
    title: "",
    branch: "lore/onboard",
    state: "open",
    labels: [],
    url: "https://gh/pr/1",
  });
  fakeSettings.setRepoVariable.mockResolvedValue(undefined);
  fakeSettings.setRepoSecret.mockResolvedValue(undefined);
});

describe("handleOnboard", () => {
  it("commits the ingest workflow even when the repo already has a .github directory", async () => {
    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    expect(fakeRepo.commitFile).toHaveBeenCalledWith(
      "lore/onboard",
      LORE_INGEST_WORKFLOW_PATH,
      LORE_INGEST_WORKFLOW_CONTENT,
      expect.stringContaining(LORE_INGEST_WORKFLOW_PATH),
    );
  });

  it("opens the PR after creating the branch and committing the workflow", async () => {
    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    expect(fakeRepo.createBranch).toHaveBeenCalledWith("lore/onboard");
    expect(fakePulls.open).toHaveBeenCalledTimes(1);
    const workflowCall =
      fakeRepo.commitFile.mock.invocationCallOrder[
        fakeRepo.commitFile.mock.calls.findIndex(
          (c) => c[1] === LORE_INGEST_WORKFLOW_PATH,
        )
      ];

    expect(workflowCall).toBeLessThan(
      fakePulls.open.mock.invocationCallOrder[0],
    );
  });
});
