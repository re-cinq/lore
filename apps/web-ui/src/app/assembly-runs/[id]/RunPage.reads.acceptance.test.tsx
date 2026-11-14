// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { AssemblyRun } from "@/lib/assembly-runs";

const run: AssemblyRun = {
  id: "0b6f6a53-8d3c-4c61-9c0e-4a5a1f4d2c11",
  blueprintName: "implementation",
  graph: null,
  taskId: null,
  repo: "re-cinq/lore",
  branch: null,
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-09-09T10:00:00.000Z",
  startedAt: null,
  durationSeconds: null,
  prUrl: null,
  prNumber: null,
  issueUrl: null,
  issueNumber: null,
  createdBy: null,
  costUsd: null,
  engine: "floor",
};

const reads = vi.hoisted(() => ({
  fetchAssemblyRun: vi.fn(),
  fetchAssemblyRunNodes: vi.fn(async () => []),
  hasAssemblyRunUpgrade: vi.fn(async () => false),
  fetchLatestRunForTask: vi.fn(async () => null),
}));

vi.mock("@/lib/assembly-runs", () => ({
  ...reads,
  isFloorEngine: () => true,
}));
vi.mock("@/lib/api/tasks", () => ({ getTask: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/task-runtime", () => ({
  fetchTaskEvents: vi.fn(async () => []),
  fetchLlmCalls: vi.fn(async () => []),
}));
vi.mock("@/lib/agents-api", () => ({ listAgents: vi.fn(async () => []) }));
vi.mock("@/lib/api/issues", () => ({ fetchIssue: vi.fn() }));
vi.mock("./RunLiveShell", () => ({ default: () => null }));

const { default: AssemblyLineResolverPage } = await import("./page");

describe("the run page's reads", () => {
  it("asks for the run, its nodes and its upgrade at once", async () => {
    reads.fetchAssemblyRun.mockReturnValue(new Promise(() => {}));

    void AssemblyLineResolverPage({ params: Promise.resolve({ id: run.id }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect({
      run: reads.fetchAssemblyRun.mock.calls,
      nodes: reads.fetchAssemblyRunNodes.mock.calls,
      upgrade: reads.hasAssemblyRunUpgrade.mock.calls,
    }).toEqual({
      run: [[run.id]],
      nodes: [[run.id]],
      upgrade: [[run.id]],
    });
  });

  it("renders the task resolver and ignores the other two answers when the id names no run", async () => {
    reads.fetchAssemblyRun.mockResolvedValue(null);

    const page = await AssemblyLineResolverPage({
      params: Promise.resolve({ id: run.id }),
    });

    expect(page.type.name).toBe("TaskRunResolver");
  });
});
