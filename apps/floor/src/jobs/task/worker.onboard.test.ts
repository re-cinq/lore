import type { PipelineTask } from "@re-cinq/lore-shared";
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
const writeAuditLog = vi.fn();

vi.mock("../../composition/project-boot.js", () => ({
  projectFor: async () => fakeProject,
}));
vi.mock("../lib/audit.js", () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));
vi.mock("./repo-context.js", () => ({
  fetchRepoContext: (...a: unknown[]) => fetchRepoContext(...a),
}));
vi.mock("../../kernel/db.js", () => ({
  query: (...a: unknown[]) => query(...a),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));
// Spread the real barrel: episode-writer moved into it, and replacing the whole
// module would take every other export down with it.
vi.mock("@re-cinq/lore-shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEpisode: (...a: unknown[]) => writeEpisode(...a),
}));

import { handleOnboard } from "./worker.js";

const savedIngestUrl = process.env.LORE_INGEST_URL;
const savedIngestToken = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  process.env.LORE_INGEST_URL = savedIngestUrl;
  process.env.LORE_INGEST_TOKEN = savedIngestToken;

  if (savedIngestUrl === undefined) {
    delete process.env.LORE_INGEST_URL;
  }

  if (savedIngestToken === undefined) {
    delete process.env.LORE_INGEST_TOKEN;
  }
});

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
  writeAuditLog.mockReset();
  writeAuditLog.mockResolvedValue(undefined);
  process.env.LORE_INGEST_URL = "https://lore.example.test";
  process.env.LORE_INGEST_TOKEN = "test-ingest-token";

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
    expect(fakePulls.open.mock.calls[0][2] as string).not.toContain(
      "Needs attention",
    );
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

  const workflowsPermission422 = () =>
    Object.assign(
      new Error(
        "Resource not accessible by integration - refusing to allow a GitHub App to create or update workflow",
      ),
      { status: 422 },
    );

  const rejectWorkflowCommits = () => {
    fakeRepo.commitFile.mockImplementation(async (_branch, path: string) => {
      if (path.startsWith(".github/workflows/")) {
        throw workflowsPermission422();
      }
    });
  };

  it("opens the PR with a needs-attention section listing files that could not be committed", async () => {
    rejectWorkflowCommits();

    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    expect(fakePulls.open).toHaveBeenCalledTimes(1);
    const body = fakePulls.open.mock.calls[0][2] as string;

    expect(body).toContain("could not be committed");
    expect(body).toContain(LORE_INGEST_WORKFLOW_PATH);
    expect(body).toContain("Resource not accessible by integration");
  });

  it("names the missing Workflows App permission when a workflows-path commit is rejected", async () => {
    rejectWorkflowCommits();

    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    const body = fakePulls.open.mock.calls[0][2] as string;

    expect(body).toContain("'Workflows: Read & write' permission");
  });

  it("keeps the permission hint out when a workflow commit fails for another reason", async () => {
    fakeRepo.commitFile.mockImplementation(async (_branch, path: string) => {
      if (path.startsWith(".github/workflows/")) {
        throw Object.assign(
          new Error('Invalid request. "sha" wasn\'t supplied.'),
          {
            status: 422,
          },
        );
      }
    });

    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    const body = fakePulls.open.mock.calls[0][2] as string;

    expect(body).toContain('"sha" wasn\'t supplied');
    expect(body).not.toContain("'Workflows: Read & write' permission");
  });

  it("configures the ingest variable and secret before opening the PR", async () => {
    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    expect(fakeSettings.setRepoVariable).toHaveBeenCalledWith(
      "LORE_INGEST_URL",
      "https://lore.example.test",
    );
    expect(fakeSettings.setRepoSecret).toHaveBeenCalledWith(
      "LORE_INGEST_TOKEN",
      "test-ingest-token",
    );
    expect(
      fakeSettings.setRepoVariable.mock.invocationCallOrder[0],
    ).toBeLessThan(fakePulls.open.mock.invocationCallOrder[0]);
    expect(fakeSettings.setRepoSecret.mock.invocationCallOrder[0]).toBeLessThan(
      fakePulls.open.mock.invocationCallOrder[0],
    );
  });

  it("reports unconfigured ingest URL and token in the PR body instead of writing an empty variable", async () => {
    delete process.env.LORE_INGEST_URL;
    delete process.env.LORE_INGEST_TOKEN;

    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    expect(fakeSettings.setRepoVariable).not.toHaveBeenCalled();
    expect(fakeSettings.setRepoSecret).not.toHaveBeenCalled();
    const body = fakePulls.open.mock.calls[0][2] as string;

    expect(body).toContain("LORE_INGEST_URL");
    expect(body).toContain("LORE_INGEST_TOKEN");
  });

  it("reports a rejected ingest-secret write in the PR body", async () => {
    fakeSettings.setRepoSecret.mockRejectedValue(
      Object.assign(new Error("Resource not accessible\nby integration"), {
        status: 403,
      }),
    );

    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    const body = fakePulls.open.mock.calls[0][2] as string;

    expect(body).toContain("LORE_INGEST_TOKEN");
    expect(body).toContain("Resource not accessible by integration");
  });

  it("records failed onboarding files in the audit log as onboard_files_failed", async () => {
    rejectWorkflowCommits();

    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "onboard_files_failed",
        task_id: "task-1",
        repo: "re-cinq/app",
        payload: expect.objectContaining({
          failed_files: expect.arrayContaining([
            expect.objectContaining({ path: LORE_INGEST_WORKFLOW_PATH }),
          ]),
        }),
      }),
    );
  });
});

describe("handleOnboard backlog label seeding", () => {
  it("seeds the priority taxonomy and lore:blocked alongside the dispatch labels", async () => {
    await handleOnboard(
      { id: "task-1" } as unknown as PipelineTask,
      "re-cinq/app",
      "lore/onboard",
      undefined,
      null,
    );

    const seeded = fakeIssues.createLabels.mock.calls.flat(2) as Array<{
      name: string;
    }>;

    expect(seeded.map((l) => l.name)).toEqual(
      expect.arrayContaining([
        "priority:high",
        "priority:medium",
        "priority:low",
        "lore:blocked",
      ]),
    );
  });
});
