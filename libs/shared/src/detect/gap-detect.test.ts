import { describe, it, expect } from "vitest";
import { gapDetectJob } from "./gap-detect.js";
import { Project } from "../index.js";
import {
  InMemoryChunks,
  type ChunkRow,
} from "../project/chunks/chunks-memory.js";
import { InMemorySettings } from "../project/settings/settings-memory.js";
import type {
  TaskStorePort,
  CreateTaskInput,
  CreatedTask,
} from "../project/tasks/task-store-port.js";
import type { PipelineTask } from "../types.js";

const REPO = "octo/repo";
const OLD = new Date(Date.now() - 100 * 86_400_000).toISOString();

let nextId = 0;

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

function presenceRows(): ChunkRow[] {
  return [
    row({ contentType: "doc", filePath: "CLAUDE.md" }),
    row({ contentType: "adr", filePath: "adrs/adr-1.md" }),
    row({ contentType: "spec", filePath: "specs/spec.md" }),
  ];
}

function staleRows(count: number): ChunkRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({ filePath: `specs/stale-${i}.md`, ingestedAt: OLD }),
  );
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

  it("files a stale-content task when 11 chunks exceed the floor of 10", async () => {
    const { project, created } = buildProject([
      ...presenceRows(),
      ...staleRows(11),
    ]);

    await gapDetectJob({ repoFilter: REPO, project });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      description: `Gap: stale-content — ${REPO} has 11 chunks not verified by reindex in >90 days`,
      taskType: "gap-fill",
      targetRepo: REPO,
      createdBy: "gap-detect",
    });
  });

  it("files no stale-content task at exactly the floor of 10", async () => {
    const { project, created } = buildProject([
      ...presenceRows(),
      ...staleRows(10),
    ]);

    await gapDetectJob({ repoFilter: REPO, project });

    expect(created).toHaveLength(0);
  });

  it("ignores stale api-ingested chunks", async () => {
    const apiStale = staleRows(11).map((chunk) => ({
      ...chunk,
      metadata: { ingested_by: "api" },
    }));
    const { project, created } = buildProject([...presenceRows(), ...apiStale]);

    await gapDetectJob({ repoFilter: REPO, project });

    expect(created).toHaveLength(0);
  });

  it("dedups against an already open gap-fill task", async () => {
    const { project, created } = buildProject(
      [...presenceRows(), ...staleRows(11)],
      { existingOpen: 1 },
    );

    const summary = await gapDetectJob({ repoFilter: REPO, project });

    expect(summary).toBe(`Checked ${REPO}, 1 gaps detected, 0 tasks created`);
    expect(created).toHaveLength(0);
  });
});
