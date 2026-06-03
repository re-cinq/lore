// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LORE_INGEST_WORKFLOW_PATH, LORE_INGEST_WORKFLOW_CONTENT } from "@re-cinq/lore-shared";

const fakePlatform = {
  createBranch: vi.fn(),
  commitFile: vi.fn(),
  createPR: vi.fn(),
  setRepoVariable: vi.fn(),
  setRepoSecret: vi.fn(),
};
const fetchRepoContext = vi.fn();
const callLLM = vi.fn();
const query = vi.fn();
const writeEpisode = vi.fn();
const createLabels = vi.fn();

vi.mock("./platform.js", () => ({ platform: () => fakePlatform }));
vi.mock("./repo-context.js", () => ({ fetchRepoContext: (...a: unknown[]) => fetchRepoContext(...a) }));
vi.mock("./anthropic.js", () => ({
  callLLM: (...a: unknown[]) => callLLM(...a),
  callLLMWithTool: vi.fn(),
}));
vi.mock("./db.js", () => ({ query: (...a: unknown[]) => query(...a) }));
vi.mock("./lib/episode-writer.js", () => ({ writeEpisode: (...a: unknown[]) => writeEpisode(...a) }));
vi.mock("./github.js", () => ({ GitHubPlatform: class { createLabels = createLabels; } }));

import { handleOnboard } from "./worker.js";

beforeEach(() => {
  for (const fn of Object.values(fakePlatform)) fn.mockReset();
  fetchRepoContext.mockReset();
  callLLM.mockReset();
  query.mockReset();
  writeEpisode.mockReset();
  createLabels.mockReset();

  // A repo that already has a .github/ directory — the case the old coarse
  // skip guard wrongly excluded the workflow from.
  fetchRepoContext.mockResolvedValue({ tree: [".github"], files: {} });
  callLLM.mockResolvedValue({ text: "SKIP" });
  query.mockResolvedValue({ rows: [] });
  writeEpisode.mockResolvedValue(undefined);
  createLabels.mockResolvedValue(undefined);
  fakePlatform.createBranch.mockResolvedValue(undefined);
  fakePlatform.commitFile.mockResolvedValue(undefined);
  fakePlatform.createPR.mockResolvedValue({ url: "https://gh/pr/1", number: 1 });
  fakePlatform.setRepoVariable.mockResolvedValue(undefined);
  fakePlatform.setRepoSecret.mockResolvedValue(undefined);
});

describe("handleOnboard", () => {
  it("commits the ingest workflow even when the repo already has a .github directory", async () => {
    await handleOnboard({ id: "task-1" }, "re-cinq/app", "lore/onboard", undefined, null);

    expect(fakePlatform.commitFile).toHaveBeenCalledWith(
      "re-cinq/app",
      "lore/onboard",
      LORE_INGEST_WORKFLOW_PATH,
      LORE_INGEST_WORKFLOW_CONTENT,
      expect.stringContaining(LORE_INGEST_WORKFLOW_PATH),
    );
  });

  it("opens the PR after creating the branch and committing the workflow", async () => {
    await handleOnboard({ id: "task-1" }, "re-cinq/app", "lore/onboard", undefined, null);

    expect(fakePlatform.createBranch).toHaveBeenCalledWith("re-cinq/app", "lore/onboard");
    expect(fakePlatform.createPR).toHaveBeenCalledTimes(1);
    const workflowCall = fakePlatform.commitFile.mock.invocationCallOrder[
      fakePlatform.commitFile.mock.calls.findIndex(c => c[2] === LORE_INGEST_WORKFLOW_PATH)
    ];
    expect(workflowCall).toBeLessThan(fakePlatform.createPR.mock.invocationCallOrder[0]);
  });
});
