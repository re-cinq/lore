import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rawSettings = vi.fn<() => Promise<unknown>>();
const activeTaskByIssue = vi.fn<() => Promise<{ id: string } | null>>();
const createTask = vi.fn<() => Promise<{ task_id: string }>>();
const setColumns = vi.fn<() => Promise<void>>();
const issuesComment = vi.fn<() => Promise<void>>();
const issuesAddLabel = vi.fn<() => Promise<void>>();

vi.mock("../../outbound/db.js", () => ({
  getPool: () => ({}),
}));

vi.mock("../../outbound/project-boot.js", () => ({
  projectFor: () =>
    Promise.resolve({
      issues: {
        comment: issuesComment,
        addLabel: issuesAddLabel,
      },
    }),
}));

vi.mock("../../outbound/queues.js", () => ({
  settings: () => ({
    rawSettings: rawSettings,
  }),
  taskStore: () => ({
    create: createTask,
  }),
  pipeline: () => ({
    taskQueue: {
      activeTaskByIssue,
      setColumns,
    },
  }),
}));

const { issuesLabeled } = await import("./github.js");

beforeEach(() => {
  rawSettings.mockReset().mockResolvedValue(null);
  activeTaskByIssue.mockReset().mockResolvedValue(null);
  createTask.mockReset().mockResolvedValue({ task_id: "task-123" });
  setColumns.mockReset().mockResolvedValue(undefined);
  issuesComment.mockReset().mockResolvedValue(undefined);
  issuesAddLabel.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("issuesLabeled", () => {
  // specs/issue-triage/spec.md#FR7
  it("dispatches issue-triage task for lore:triage label", async () => {
    await issuesLabeled(
      {
        repo: "org/repo",
        label: "lore:triage",
        issue: {
          number: 42,
          title: "Bug",
          body: "Body",
          html_url: "url",
          labels: ["lore:triage"],
        },
      },
      {} as any,
    );

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "issue-triage",
      }),
    );
  });

  // specs/issue-triage/spec.md#FR7
  it("dispatches issue-triage task for triage: needs-triage label", async () => {
    await issuesLabeled(
      {
        repo: "org/repo",
        label: "triage: needs-triage",
        issue: {
          number: 42,
          title: "Bug",
          body: "Body",
          html_url: "url",
          labels: ["triage: needs-triage"],
        },
      },
      {} as any,
    );

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "issue-triage",
      }),
    );
  });
});
