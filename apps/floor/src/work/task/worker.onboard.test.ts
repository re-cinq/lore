import type { PipelineTask } from "@re-cinq/lore-shared";
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
  TRACE_IMPACT_WORKFLOW_PATH,
} from "@re-cinq/lore-shared";

const fakeRepo = {
  createBranch: vi.fn(),
  branchExists: vi.fn(),
  commitFile: vi.fn(),
  tree: vi.fn(),
  isConfigured: vi.fn(() => true),
  defaultBranch: vi.fn(),
};
const fakeSettings = { setRepoVariable: vi.fn(), setRepoSecret: vi.fn() };
const fakeIssues = { comment: vi.fn(), createLabels: vi.fn() };
const fakeProject = {
  repo: fakeRepo,
  settings: fakeSettings,
  issues: fakeIssues,
};

const handleClaudeCodeTask = vi.fn();
const writeAuditLog = vi.fn();

vi.mock("./handle-claude-code-task.js", () => ({
  handleClaudeCodeTask: (...a: unknown[]) => handleClaudeCodeTask(...a),
}));
vi.mock("../../outbound/audit.js", () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

import { handleOnboard } from "./handle-onboard.js";

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
    ...Object.values(fakeSettings),
    ...Object.values(fakeIssues),
  ]) {
    fn.mockReset();
  }
  handleClaudeCodeTask.mockReset();
  writeAuditLog.mockReset();
  writeAuditLog.mockResolvedValue(undefined);
  handleClaudeCodeTask.mockResolvedValue(undefined);
  process.env.LORE_INGEST_URL = "https://lore.example.test";
  process.env.LORE_INGEST_TOKEN = "test-ingest-token";

  fakeRepo.tree.mockResolvedValue([
    ".github",
    ".github/CODEOWNERS",
    "README.md",
  ]);
  fakeRepo.branchExists.mockResolvedValue(false);
  fakeRepo.defaultBranch.mockResolvedValue("develop");
  fakeIssues.createLabels.mockResolvedValue(undefined);
  fakeIssues.comment.mockResolvedValue(undefined);
  fakeRepo.createBranch.mockResolvedValue(undefined);
  fakeRepo.commitFile.mockResolvedValue(undefined);
  fakeRepo.isConfigured.mockReturnValue(true);
  fakeSettings.setRepoVariable.mockResolvedValue(undefined);
  fakeSettings.setRepoSecret.mockResolvedValue(undefined);
});

const task = { id: "task-1", task_type: "onboard" } as unknown as PipelineTask;

const onboard = (issueNumber: number | null = 7) =>
  handleOnboard({
    task,
    targetRepo: "re-cinq/app",
    branchName: "lore/onboard",
    model: undefined,
    issueNumber,
    project: fakeProject as unknown as Parameters<
      typeof handleOnboard
    >[0]["project"],
    repoSettings: {},
    repoOverrides: undefined,
    agentDef: null,
    darkFactoryEnabled: false,
    isFeaturePlanningType: false,
  });

const committedPaths = () =>
  fakeRepo.commitFile.mock.calls.map((call) => call[1] as string);

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

describe("handleOnboard", () => {
  it("creates the branch off the default branch and commits the ingest workflow onto it even when the repo already has a .github directory", async () => {
    await onboard();

    expect(fakeRepo.createBranch).toHaveBeenCalledWith(
      "lore/onboard",
      "develop",
    );
    expect(fakeRepo.commitFile).toHaveBeenCalledWith(
      "lore/onboard",
      LORE_INGEST_WORKFLOW_PATH,
      LORE_INGEST_WORKFLOW_CONTENT,
      expect.stringContaining(LORE_INGEST_WORKFLOW_PATH),
    );
    expect(committedPaths()).toContain(TRACE_IMPACT_WORKFLOW_PATH);
  });

  it("commits the issue templates and .claude/settings.json when the branch lacks them, skipping an exact path it carries", async () => {
    fakeRepo.tree.mockResolvedValue([
      ".github",
      ".github/ISSUE_TEMPLATE/config.yml",
    ]);

    await onboard();

    expect(committedPaths()).toEqual(
      expect.arrayContaining([
        ".claude/settings.json",
        ".github/ISSUE_TEMPLATE/lore-implementation.yml",
        ".github/ISSUE_TEMPLATE/lore-review.yml",
      ]),
    );
    expect(committedPaths()).not.toContain(".github/ISSUE_TEMPLATE/config.yml");
  });

  it("hands the ticket to the onboard assembly line on the scaffolded branch, off the repo's default branch, after the scaffold landed", async () => {
    await onboard();

    expect(handleClaudeCodeTask).toHaveBeenCalledTimes(1);
    expect(handleClaudeCodeTask.mock.calls[0][0]).toMatchObject({
      task,
      targetRepo: "re-cinq/app",
      branchName: "lore/onboard",
      darkFactory: { assemblyLine: "onboard", baseBranch: "develop" },
    });
    const lastCommit = Math.max(
      ...fakeRepo.commitFile.mock.invocationCallOrder,
    );

    expect(lastCommit).toBeLessThan(
      handleClaudeCodeTask.mock.invocationCallOrder[0],
    );
  });

  it("opens no pull request itself and calls no model: the line's push node opens the one PR", async () => {
    await onboard();

    expect(fakeProject).not.toHaveProperty("pulls");
    expect(fakeIssues.comment).not.toHaveBeenCalled();
  });

  it("comments the files that could not be committed on the ticket, naming the missing Workflows App permission", async () => {
    rejectWorkflowCommits();

    await onboard();

    expect(fakeIssues.comment).toHaveBeenCalledTimes(1);
    const [issue, body] = fakeIssues.comment.mock.calls[0] as [number, string];

    expect(issue).toBe(7);
    expect(body).toContain("could not be committed");
    expect(body).toContain(LORE_INGEST_WORKFLOW_PATH);
    expect(body).toContain("'Workflows: Read & write' permission");
    expect(handleClaudeCodeTask).toHaveBeenCalledTimes(1);
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

    await onboard();

    const body = fakeIssues.comment.mock.calls[0][1] as string;

    expect(body).toContain('"sha" wasn\'t supplied');
    expect(body).not.toContain("'Workflows: Read & write' permission");
  });

  it("configures the ingest variable and secret before dispatching the line", async () => {
    await onboard();

    expect(fakeSettings.setRepoVariable).toHaveBeenCalledWith(
      "LORE_INGEST_URL",
      "https://lore.example.test",
    );
    expect(fakeSettings.setRepoSecret).toHaveBeenCalledWith(
      "LORE_INGEST_TOKEN",
      "test-ingest-token",
    );
    expect(fakeSettings.setRepoSecret.mock.invocationCallOrder[0]).toBeLessThan(
      handleClaudeCodeTask.mock.invocationCallOrder[0],
    );
  });

  it("reports an unconfigured ingest URL and token on the ticket instead of writing an empty variable", async () => {
    delete process.env.LORE_INGEST_URL;
    delete process.env.LORE_INGEST_TOKEN;

    await onboard();

    expect(fakeSettings.setRepoVariable).not.toHaveBeenCalled();
    expect(fakeSettings.setRepoSecret).not.toHaveBeenCalled();
    const body = fakeIssues.comment.mock.calls[0][1] as string;

    expect(body).toContain("LORE_INGEST_URL");
    expect(body).toContain("LORE_INGEST_TOKEN");
  });

  it("reports a rejected ingest-secret write on the ticket", async () => {
    fakeSettings.setRepoSecret.mockRejectedValue(
      Object.assign(new Error("Resource not accessible\nby integration"), {
        status: 403,
      }),
    );

    await onboard();

    const body = fakeIssues.comment.mock.calls[0][1] as string;

    expect(body).toContain("LORE_INGEST_TOKEN");
    expect(body).toContain("Resource not accessible by integration");
  });

  it("still audits and dispatches an enrolment gap when the task has no ticket to comment on", async () => {
    rejectWorkflowCommits();

    await onboard(null);

    expect(fakeIssues.comment).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(handleClaudeCodeTask).toHaveBeenCalledTimes(1);
  });

  it("records failed onboarding files in the audit log as onboard_files_failed", async () => {
    rejectWorkflowCommits();

    await onboard();

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
    await onboard();

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
