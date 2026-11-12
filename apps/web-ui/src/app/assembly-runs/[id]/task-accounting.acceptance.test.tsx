// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import RunLiveShell, { type RunLiveShellProps } from "./RunLiveShell";
import type { AssemblyRun } from "@/lib/assembly-runs";
import { implementationDefinition } from "@/lib/definition-fixtures";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";

vi.mock("./live-actions", () => ({
  openRunChannelAction: async () => ({ token: "tok" }),
}));

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
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ events: [] }),
    }),
  );

  return render(
    <LiveSocketProvider url="ws://test/api/ws" socket={FakeWebSocket}>
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Task accounting layout", () => {
  it("draws LlmCallsTable after the run facts outside the aside without a Task accounting heading when taskId is present", async () => {
    renderShell({ run: { ...run, taskId: "task-123" } });

    await act(async () => {
      await Promise.resolve();
    });

    const facts = screen.getByText("Branch");
    const llmCalls = screen.getByText("LLM Calls");
    const aside = screen.getByRole("complementary", { name: "Selected node" });

    expect({
      factsThenCostTable: Boolean(
        facts.compareDocumentPosition(llmCalls) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      inAside: aside.contains(llmCalls),
      heading: screen.queryByRole("heading", { name: "Task accounting" }),
      eventTimeline: screen.queryByText(/Event\s*Timeline/),
    }).toEqual({
      factsThenCostTable: true,
      inAside: false,
      heading: null,
      eventTimeline: null,
    });
  });
});
