import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { gapDetectJob } from "./gap-detect.js";
import { Project } from "../../outbound/project/lib/project.js";
import {
  InMemoryChunks,
  type ChunkRow,
} from "../../outbound/project/chunks/chunks-memory.js";
import { InMemorySettings } from "../../outbound/project/settings/settings-memory.js";
import type {
  TaskStorePort,
  CreateTaskInput,
  CreatedTask,
} from "../../outbound/project/tasks/task-store-port.js";
import type { PipelineTask } from "../../domain/types.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const REPO = "octo/repo";
let nextId = 0;

function presenceRows(): ChunkRow[] {
  return [
    row({ contentType: "doc", filePath: "CLAUDE.md" }),
    row({ contentType: "adr", filePath: "adrs/adr-1.md" }),
    row({ contentType: "spec", filePath: "specs/spec.md" }),
  ];
}

function row(overrides: Partial<ChunkRow>): ChunkRow {
  return {
    id: String(++nextId),
    schema: "platform",
    content: "content",
    contentType: "spec",
    team: "platform",
    repo: REPO,
    filePath: "specs/spec.md",
    metadata: { ingested_by: "reindex-job" },
    embedding: null,
    ingestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildProject(
  rows: ChunkRow[],
  options: { existingOpen?: number; onboarded?: boolean } = {},
): { project: Project; created: CreateTaskInput[] } {
  const { store, created } = taskStoreStub(options.existingOpen ?? 0);
  const settings = new InMemorySettings([
    {
      full_name: REPO,
      team: "platform",
      onboarding_pr_merged: options.onboarded ?? true,
    },
  ]);
  const chunks = new InMemoryChunks(rows, new Set(["org_shared", "platform"]));
  const project = new Project(
    REPO,
    new Map<string, unknown>([
      ["chunks", chunks],
      ["settings", settings],
      ["tasks", store],
    ]),
  );

  return { project, created };
}

function taskStoreStub(existingOpen = 0): {
  store: TaskStorePort;
  created: CreateTaskInput[];
} {
  const created: CreateTaskInput[] = [];
  const store = {
    async findOpenLike(): Promise<PipelineTask[]> {
      return Array.from(
        { length: existingOpen },
        () => ({ task_id: "open" }) as unknown as PipelineTask,
      );
    },
    async create(input: CreateTaskInput): Promise<CreatedTask> {
      created.push(input);

      return {
        task_id: `t${created.length}`,
        task_type: input.taskType ?? "gap-fill",
        status: "pending",
        priority: "normal",
        created_at: new Date().toISOString(),
      };
    },
  } as unknown as TaskStorePort;

  return { store, created };
}

describe("gapDetectJob", () => {
  it("skips a repo that is not onboarded", async () => {
    const { project, created } = buildProject([], { onboarded: false });

    const summary = await gapDetectJob({ repoFilter: REPO, project });

    expect(summary).toBe(`Repo ${REPO} not onboarded`);
    expect(created).toHaveLength(0);
  });

  it("sees team-schema chunks and files no missing-content gaps", async () => {
    const { project, created } = buildProject(presenceRows());

    const summary = await gapDetectJob({ repoFilter: REPO, project });

    expect(summary).toBe(`Checked ${REPO}, 0 gaps detected, 0 tasks created`);
    expect(created).toHaveLength(0);
  });

  it("files missing-content gap-fill tasks when the repo has no chunks", async () => {
    const { project, created } = buildProject([]);

    await gapDetectJob({ repoFilter: REPO, project });

    expect(created.map((task) => task.description)).toEqual([
      `Gap: missing-claude-md — ${REPO} has no CLAUDE.md in context`,
      `Gap: missing-adrs — ${REPO} has no architecture decision records`,
      `Gap: missing-specs — ${REPO} has no spec files in context`,
    ]);
  });

  it("dedups against an already open gap-fill task", async () => {
    const { project, created } = buildProject(
      presenceRows().filter((chunk) => chunk.contentType !== "spec"),
      { existingOpen: 1 },
    );

    const summary = await gapDetectJob({ repoFilter: REPO, project });

    expect(summary).toBe(`Checked ${REPO}, 1 gaps detected, 0 tasks created`);
    expect(created).toHaveLength(0);
  });
});
