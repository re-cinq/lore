// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import RunLiveShell, { type RunLiveShellProps } from "./RunLiveShell";
import type { AssemblyRun } from "@/lib/assembly-runs";
import { implementationDefinition } from "@/lib/definition-fixtures";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";
import { answeringSocketFrom } from "@/lib/live-socket/answering-socket";

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

function renderShell(extra: Partial<RunLiveShellProps> = {}) {
  FakeWebSocket.reset();
  const socket = answeringSocketFrom(async () => Response.json({ events: [] }));

  return render(
    <LiveSocketProvider url="ws://test/api/ws" socket={socket}>
      <RunLiveShell
        run={run}
        nodes={[]}
        definition={implementationDefinition}
        taskEvents={[]}
        llmCalls={[]}
        {...extra}
      />
    </LiveSocketProvider>,
  );
}

describe("Task accounting layout", () => {
  it("groups EventTimeline and LlmCallsTable under a 'Task accounting' heading when taskId is present", async () => {
    await act(async () => {
      renderShell({ run: { ...run, taskId: "task-123" } });
    });

    const heading = screen.getByRole("heading", { name: "Task accounting" });

    expect(heading).toBeInTheDocument();
    expect(screen.getByText("LLM Calls")).toBeInTheDocument();
    expect(screen.getByText("EventTimeline")).toBeInTheDocument();
  });
});
