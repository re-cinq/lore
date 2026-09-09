// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import RunLiveShell from "./RunLiveShell";
import type { AssemblyRun } from "@/lib/assembly-runs";
import { implementationDefinition } from "@/lib/definition-fixtures";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (e: MessageEvent) => void>();
  onerror: ((e: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(name, fn);
  }

  removeEventListener(name: string) {
    this.listeners.delete(name);
  }

  close() {}

  emit(name: string, payload: unknown) {
    this.listeners.get(name)?.({
      data: JSON.stringify(payload),
    } as MessageEvent);
  }
}

const run: AssemblyRun = {
  id: "run-1",
  blueprintName: "implementation",
  graph: null,
  taskId: "task-1",
  repo: "re-cinq/lore",
  branch: "feat/x",
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-09-09T10:00:00.000Z",
  startedAt: "2026-09-09T10:00:05.000Z",
  durationSeconds: null,
  prUrl: null,
  prNumber: null,
  issueUrl: null,
  issueNumber: null,
  createdBy: null,
  costUsd: null,
};

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function renderShell() {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ events: [] }),
    }),
  );

  return render(
    <RunLiveShell
      run={run}
      nodes={[]}
      definition={implementationDefinition}
      taskEvents={[]}
      llmCalls={[]}
    />,
  );
}

async function emit(name: string, payload: unknown) {
  await act(async () => {
    FakeEventSource.instances[0].emit(name, payload);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RunLiveShell", () => {
  it("flips the header to the run's terminal status on a run_status frame without a reload", async () => {
    renderShell();
    await settle();

    expect(screen.getByText("Running")).toBeInTheDocument();

    await emit("run_status", {
      type: "run_status",
      run: {
        id: "run-1",
        status: "finished",
        outcome: "success",
        reason: null,
        started_at: "2026-09-09T10:00:05.000Z",
        finished_at: "2026-09-09T10:05:05.000Z",
      },
    });

    expect(
      screen.getByRole("heading", { level: 1 }).nextElementSibling,
    ).toHaveTextContent("success");
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("adds a visit the stream reports to the graph as a running node", async () => {
    const { container } = renderShell();

    await settle();
    await emit("node_status", {
      type: "node_status",
      node: {
        node_id: "implement",
        iteration: 1,
        outcome: null,
        agent_cr_name: "05fc-implement",
        station_run_id: "sr-1",
        input: null,
        commit_sha: null,
        started_at: "2026-09-09T10:00:10.000Z",
        finished_at: null,
        status: "running",
        claimed_at: null,
      },
    });

    expect(
      container.querySelector('[data-node="implement"]')?.textContent,
    ).toContain("Running");
  });

  it("adds a task transition the stream reports to the selected node's transcript", async () => {
    const { container } = renderShell();

    await settle();
    await emit("node_status", {
      type: "node_status",
      node: {
        node_id: "implement",
        iteration: 1,
        outcome: null,
        agent_cr_name: "05fc-implement",
        station_run_id: "sr-1",
        input: null,
        commit_sha: null,
        started_at: "2026-09-09T10:00:10.000Z",
        finished_at: null,
        status: "running",
        claimed_at: null,
      },
    });
    await settle();
    await emit("task_event", {
      type: "task_event",
      event: {
        id: "7",
        task_id: "task-1",
        from_status: "running",
        to_status: "pr_created",
        metadata: null,
        created_at: "2026-09-09T10:04:00.000Z",
      },
    });
    await settle();

    expect(container.querySelector("[data-task-event]")).toHaveTextContent(
      "task Running → PR created",
    );
  });
});
