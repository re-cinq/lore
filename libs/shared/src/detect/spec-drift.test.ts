import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { specDriftJob } from "./spec-drift.js";
import { Project } from "../index.js";
import type { ChunksPort } from "../project/chunks/chunks-port.js";
import type { GitHubPort } from "../project/lib/github-port.js";
import type { TracePort } from "../project/trace/trace-port.js";
import type {
  TaskStorePort,
  CreateTaskInput,
  CreatedTask,
} from "../project/tasks/task-store-port.js";
import type { TraceDocument } from "../spec-trace/assemble-trace-document.js";

const REPO = "octo/repo";
const savedDgraph = process.env.LORE_DGRAPH_HTTP;

function driftedDocument(filePath: string): TraceDocument {
  return {
    filePath,
    title: "spec",
    description: "",
    sections: [],
    statements: [
      {
        uid: "0x1",
        ordinal: 1,
        text: "claims a task",
        state: "tested",
        violated: true,
        links: [],
      },
    ],
    coverage: { testable: 1, covered: 1, untestable: 0, ratio: 1 },
  };
}

function buildProject(specPaths: string[]): {
  project: Project;
  created: CreateTaskInput[];
} {
  const created: CreateTaskInput[] = [];
  const chunks = {
    async specChunks() {
      return specPaths.map((filePath, i) => ({
        id: String(i + 1),
        repo: REPO,
        filePath,
        content: "body",
      }));
    },
    async codeSymbols() {
      return [];
    },
  } as unknown as ChunksPort;
  const github = {
    async listIssues() {
      return [];
    },
  } as unknown as GitHubPort;
  const trace = {
    async document(_repo: string, filePath: string) {
      return driftedDocument(filePath);
    },
  } as unknown as TracePort;
  const tasks = {
    async driftTasksForSpec() {
      return [];
    },
    async create(input: CreateTaskInput): Promise<CreatedTask> {
      created.push(input);

      return {
        task_id: `t${created.length}`,
        task_type: "gap-fill",
        status: "pending",
        priority: "normal",
        created_at: new Date().toISOString(),
      };
    },
  } as unknown as TaskStorePort;
  const project = new Project(
    REPO,
    new Map<string, unknown>([
      ["chunks", chunks],
      ["github", github],
      ["trace", trace],
      ["tasks", tasks],
    ]),
  );

  return { project, created };
}

describe("specDriftJob", () => {
  beforeEach(() => {
    process.env.LORE_DGRAPH_HTTP = "http://dgraph.test:8080";
  });

  afterEach(() => {
    if (savedDgraph === undefined) {
      delete process.env.LORE_DGRAPH_HTTP;

      return;
    }
    process.env.LORE_DGRAPH_HTTP = savedDgraph;
  });

  it("counts a graph-drifted spec as filed and creates one gap-fill task", async () => {
    const { project, created } = buildProject(["specs/one/spec.md"]);

    const summary = await specDriftJob({ repoFilter: REPO, project });

    expect(summary).toBe(
      `Checked 1 specs in ${REPO} (1 drifted); skipped 0 prose docs`,
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      taskType: "gap-fill",
      targetRepo: REPO,
      createdBy: "spec-drift",
    });
  });

  it("defers the fourth drifted spec over the 3-per-run cap", async () => {
    const { project, created } = buildProject([
      "specs/a/spec.md",
      "specs/b/spec.md",
      "specs/c/spec.md",
      "specs/d/spec.md",
    ]);

    const summary = await specDriftJob({ repoFilter: REPO, project });

    expect(summary).toBe(
      `Checked 4 specs in ${REPO} (3 drifted; deferred 1 over the 3/run cap); skipped 0 prose docs`,
    );
    expect(created).toHaveLength(3);
  });
});
