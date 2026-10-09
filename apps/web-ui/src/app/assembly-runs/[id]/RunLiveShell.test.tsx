// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import RunLiveShell, { type RunLiveShellProps } from "./RunLiveShell";
import type { AssemblyRun } from "@/lib/assembly-runs";
import {
  featurePlanningDefinition,
  implementationDefinition,
} from "@/lib/definition-fixtures";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";
import type { RunStreamFrame } from "@/lib/run-stream-types";

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

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

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

async function emit(_name: string, payload: unknown) {
  await act(async () => {
    await FakeWebSocket.latest.acceptAndOpenAll();
  });
  await act(async () => {
    FakeWebSocket.latest.receive({
      type: "frame",
      channel: FakeWebSocket.latest.opens[0].channel,
      frame: payload as RunStreamFrame,
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RunLiveShell", () => {
  it("reads the header Waiting for you, not Running, while the run's only open visit is on author", () => {
    renderShell({
      run: { ...run, status: "running" },
      definition: featurePlanningDefinition,
      nodes: [
        {
          nodeId: "author",
          iteration: 2,
          outcome: null,
          agentCrName: null,
          commitSha: null,
          durationSeconds: null,
        },
      ],
    });

    expect(
      screen.getByRole("heading", { level: 1 }).parentElement,
    ).toHaveTextContent("Waiting for you");
  });

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

  it("shows the issue the run works on as a card, so reading it needs no trip to GitHub", async () => {
    renderShell({
      issue: {
        number: 42,
        title: "Show the issue on the run page",
        state: "open",
        url: "https://github.com/re-cinq/lore/issues/42",
        body: "## Why",
      },
    });
    await settle();

    expect(
      screen.getByText("Issue #42 · Show the issue on the run page"),
    ).toBeInTheDocument();
  });

  it("marks the page flush, so the shell leaves the gutters to the panel", async () => {
    const { container } = renderShell();

    await settle();

    expect(container.querySelector("[data-flush-page]")).not.toBeNull();
  });

  it("draws the header above the graph and the issue card below the facts, all outside the aside", async () => {
    const { container } = renderShell({
      issue: {
        number: 42,
        title: "Show the issue on the run page",
        state: "open",
        url: "https://github.com/re-cinq/lore/issues/42",
        body: "## Why",
      },
    });

    await settle();

    const order = [
      screen.getByRole("heading", { name: "implementation", level: 1 }),
      container.querySelector("[data-node]") as Node,
      screen.getByText("Branch"),
      screen.getByText("Issue #42 · Show the issue on the run page"),
    ];
    const aside = screen.getByRole("complementary", { name: "Selected node" });

    expect({
      inReadingOrder: order.every(
        (node, i) =>
          i === 0 ||
          Boolean(
            order[i - 1].compareDocumentPosition(node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
      ),
      inAside: order.map((node) => aside.contains(node)),
    }).toEqual({
      inReadingOrder: true,
      inAside: [false, false, false, false],
    });
  });

  it("draws the run facts under the graph and the task-less notice after them, both outside the aside", async () => {
    const { container } = renderShell({ run: { ...run, taskId: null } });

    await settle();

    const graph = container.querySelector("[data-node]") as Node;
    const facts = screen.getByText("Branch");
    const notice = screen.getByText(/This run has no backing task/);
    const aside = screen.getByRole("complementary", { name: "Selected node" });

    expect({
      graphThenFacts: Boolean(
        graph.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      factsThenNotice: Boolean(
        facts.compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      inAside: [facts, notice].map((node) => aside.contains(node)),
    }).toEqual({
      graphThenFacts: true,
      factsThenNotice: true,
      inAside: [false, false],
    });
  });

  it("says a task-less run has no cost when its cost is unknown", async () => {
    renderShell({ run: { ...run, taskId: null, costUsd: null } });
    await settle();

    expect(
      screen.getByText(
        "This run has no backing task — cost and status-transition history are not available.",
      ),
    ).toBeInTheDocument();
  });

  it("leaves cost out of the task-less notice when the run cost 0.42 dollars", async () => {
    renderShell({ run: { ...run, taskId: null, costUsd: 0.42 } });
    await settle();

    expect(
      screen.getByText(
        "This run has no backing task — status-transition history is not available.",
      ),
    ).toBeInTheDocument();
  });
});
