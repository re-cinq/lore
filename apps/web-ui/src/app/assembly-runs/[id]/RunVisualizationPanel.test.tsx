// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import RunVisualizationPanel from "./RunVisualizationPanel";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { codeReviewDefinition } from "@/lib/definition-fixtures";
import { HISTORY_PAGE_LIMIT } from "@/lib/run-stream-presenter";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";
import type { RunStreamFrame } from "@/lib/run-stream-types";

vi.mock("./live-actions", () => ({
  openRunChannelAction: async () => ({ token: "tok" }),
}));

const definition: AssemblyLineDefinition = {
  name: "implementation",
  description: "implement then validate",
  version: 1,
  entry: "implement",
  exit: "validate",
  nodes: [
    { id: "implement", type: "agent" },
    { id: "validate", type: "validate" },
  ],
  edges: [{ from: "implement", to: "validate", on: "success" }],
};

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: "1",
    taskId: "task-1",
    agentCrName: null,
    assemblyLineId: "run-1",
    nodeId: "implement",
    iteration: 1,
    eventType: "init",
    toolName: null,
    toolUseId: null,
    isError: false,
    filePaths: [],
    summary: null,
    payload: {},
    createdAt: "2026-07-20T10:00:00.000Z",
    ...over,
  };
}

function stubHistory(...pages: unknown[][]) {
  const fetchMock = vi.fn();

  for (const page of pages) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ events: page }),
    });
  }
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ events: [] }),
  });
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function useFakeSocket() {
  FakeWebSocket.reset();
}

async function openChannels() {
  await act(async () => {
    await FakeWebSocket.latest.acceptAndOpenAll();
  });
}

async function emitFrame(frame: RunStreamFrame) {
  await act(async () => {
    FakeWebSocket.latest.receive({
      type: "frame",
      channel: FakeWebSocket.latest.opens[0].channel,
      frame,
    });
  });
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function renderPanel(runStatus: string) {
  return render(
    <LiveSocketProvider url="ws://test/api/ws" socket={FakeWebSocket}>
      {panel(runStatus)}
    </LiveSocketProvider>,
  );
}

function renderPanelWithoutSocket(runStatus: string) {
  return render(panel(runStatus));
}

function panel(runStatus: string) {
  return (
    <RunVisualizationPanel
      runId="run-1"
      runStatus={runStatus}
      definition={definition}
      nodes={[]}
      repo="re-cinq/lore"
      reason={null}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("stream lifecycle", () => {
  it("opens no channel for a finished run", async () => {
    stubHistory([]);
    useFakeSocket();

    renderPanel("finished");
    await settle();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("opens one run channel on the tab's socket for a running run", async () => {
    stubHistory([]);
    useFakeSocket();

    renderPanel("running");
    await settle();
    await openChannels();

    expect(FakeWebSocket.latest.opens).toMatchObject([
      { kind: "run", subject: "run-1", token: "tok" },
    ]);
  });

  it("opens the channel only after the history fold sets lastEventId", async () => {
    stubHistory([eventRow({ id: "7" })]);
    useFakeSocket();

    renderPanel("running");
    await settle();
    await openChannels();

    expect(FakeWebSocket.latest.opens[0]).toMatchObject({ after: "7" });
  });

  it("closes the channel on unmount and leaves the socket open", async () => {
    stubHistory([]);
    useFakeSocket();

    const view = renderPanel("running");

    await settle();
    await openChannels();
    view.unmount();

    expect({
      sent: FakeWebSocket.latest.sent.at(-1),
      closed: FakeWebSocket.latest.closed,
    }).toEqual({ sent: { type: "close", channel: "c1" }, closed: false });
  });

  it("opens no channel when no live socket is configured", async () => {
    stubHistory([]);
    useFakeSocket();

    renderPanelWithoutSocket("running");
    await settle();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe("history fold", () => {
  it("renders the node status from a folded history event", async () => {
    stubHistory([eventRow({ id: "3", eventType: "init" })]);
    useFakeSocket();

    renderPanel("running");
    await settle();

    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("pages history until a page shorter than the limit arrives", async () => {
    const fullPage = Array.from({ length: HISTORY_PAGE_LIMIT }, (_, i) =>
      eventRow({ id: String(i + 1) }),
    );
    const fetchMock = stubHistory(fullPage, [eventRow({ id: "1001" })]);

    useFakeSocket();

    renderPanel("running");
    await settle();

    const historyCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/events"),
    );

    expect(historyCalls).toHaveLength(2);
    expect(String(historyCalls[1][0])).toContain(`after=${HISTORY_PAGE_LIMIT}`);
  });

  it("renders the graph and folded history without a live socket", async () => {
    stubHistory([eventRow({ id: "3" })]);
    useFakeSocket();

    renderPanelWithoutSocket("running");
    await settle();

    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });
});

describe("degradation", () => {
  it("renders the seeded graph with an offline label when the history fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    useFakeSocket();

    renderPanel("running");
    await settle();

    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("renders the graph and opens no channel when the history read returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Run not found" }),
      }),
    );
    useFakeSocket();

    renderPanel("running");
    await settle();

    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe("live events", () => {
  it("applies an agent_event frame to the graph", async () => {
    stubHistory([]);
    useFakeSocket();

    renderPanel("running");
    await settle();
    await openChannels();
    await emitFrame({
      type: "agent_event",
      event: eventRow({
        id: "9",
        nodeId: "validate",
        eventType: "init",
      }) as never,
    });

    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("does not reopen the channel when a live event updates afterId", async () => {
    stubHistory([]);
    useFakeSocket();

    renderPanel("running");
    await settle();
    await openChannels();
    await emitFrame({
      type: "agent_event",
      event: eventRow({
        id: "42",
        nodeId: "implement",
        eventType: "init",
      }) as never,
    });
    await settle();

    expect(FakeWebSocket.latest.opens).toHaveLength(1);
  });
});

describe("heatmap wiring and the live clock", () => {
  it("grows the file heatmap as tool call events stream in", async () => {
    stubHistory([
      eventRow({ id: "1", nodeId: "implement", eventType: "init" }),
      eventRow({
        id: "2",
        nodeId: "implement",
        eventType: "tool_call",
        toolName: "Edit",
        filePaths: ["src/a.ts"],
      }),
    ]);
    useFakeSocket();

    const { container } = renderPanel("running");

    await settle();

    expect(container.querySelectorAll("[data-path]")).toHaveLength(1);
    expect(screen.getAllByText("src/a.ts").length).toBeGreaterThan(0);

    await openChannels();
    await emitFrame({
      type: "agent_event",
      event: eventRow({
        id: "9",
        nodeId: "implement",
        eventType: "tool_call",
        toolName: "Edit",
        filePaths: ["src/b.ts"],
      }) as never,
    });

    expect(container.querySelectorAll("[data-path]")).toHaveLength(2);
  });

  it("ticks a live run's clock forward on an interval so a running node's duration advances", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");

    try {
      stubHistory([]);
      renderPanel("running");

      expect(spy).toHaveBeenCalledWith(expect.any(Function), 1000);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("starts no clock for a terminal run, which cannot stall", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");

    try {
      stubHistory([]);
      renderPanel("finished");

      expect(spy).not.toHaveBeenCalledWith(expect.any(Function), 1000);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("run-graph verdict on a finished run (regression)", () => {
  const nodeTone = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-node="${id}"]`)?.getAttribute("data-tone");
  const nodeText = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-node="${id}"]`)?.textContent ?? "";

  it("shows a failed review's verdict, not its clean pod exit, and a failed terminal", async () => {
    stubHistory([
      eventRow({ id: "1", nodeId: "review", eventType: "init" }),
      eventRow({
        id: "2",
        nodeId: "review",
        eventType: "result",
        isError: false,
      }),
    ]);
    useFakeSocket();

    const { container } = render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="finished"
        definition={codeReviewDefinition}
        nodes={[
          {
            nodeId: "review",
            iteration: 1,
            outcome: "failed",
            agentCrName: null,
            commitSha: null,
            durationSeconds: 184,
          },
          {
            nodeId: "done",
            iteration: 1,
            outcome: "success",
            agentCrName: null,
            commitSha: null,
            durationSeconds: 1,
          },
        ]}
        repo="re-cinq/lore"
        reason={'node "review" failed'}
      />,
    );

    await settle();

    expect(nodeTone(container, "review")).toBe("err");
    expect(nodeText(container, "review")).toContain("Failed");
    expect(nodeTone(container, "done")).toBe("err");
    expect(nodeText(container, "done")).toContain("Failed");
    expect(nodeText(container, "review")).not.toContain("Succeeded");
  });
});

describe("stream give-up and history polling", () => {
  async function dropSocket(times: number) {
    for (let i = 0; i < times; i++) {
      await act(async () => {
        FakeWebSocket.latest.drop();
        vi.advanceTimersByTime(30000);
      });
    }
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up the socket after six consecutive drops and degrades to Polling", async () => {
    vi.useFakeTimers();
    stubHistory([]);
    useFakeSocket();

    renderPanel("running");
    await settle();
    await dropSocket(6);

    expect(FakeWebSocket.instances).toHaveLength(6);
    expect(screen.getByText("Polling")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(FakeWebSocket.instances).toHaveLength(6);
  });

  it("polls the history proxy from the reducer cursor after giving up and applies new rows", async () => {
    vi.useFakeTimers(); // eslint-disable-next-line re-lint/declare-near-use -- the history stub must be installed before the render it serves
    const fetchMock = stubHistory([
      eventRow({ id: "5", nodeId: "implement", eventType: "init" }),
    ]);

    useFakeSocket();

    const { container } = renderPanel("running");

    await settle();
    await dropSocket(6);

    const validate = container.querySelector('[data-node="validate"]');

    expect(validate?.getAttribute("data-tone")).toBe("idle");

    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        events: [eventRow({ id: "6", nodeId: "validate", eventType: "init" })],
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    await settle();

    expect(String(fetchMock.mock.calls[0][0])).toContain("after=5");
    expect(
      container.querySelector('[data-node="validate"]')?.textContent,
    ).toContain("Running");
  });
});

describe("node inspector", () => {
  const HINT =
    "Select a node in the graph to inspect its detail, transcript, and pod logs.";

  async function selectNode(name: string) {
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${name} —`) }),
      );
    });
  }

  function walkRow(over: Partial<AssemblyRunNode>): AssemblyRunNode {
    return {
      nodeId: "implement",
      iteration: 1,
      outcome: "success",
      agentCrName: null,
      commitSha: null,
      durationSeconds: 30,
      ...over,
    };
  }

  function renderWithNodes(nodes: AssemblyRunNode[]) {
    return render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={definition}
        nodes={nodes}
        repo="re-cinq/lore"
        reason={null}
      />,
    );
  }

  it("shows the select-a-node hint while every node is idle, and opens the inspector on a click", async () => {
    stubHistory([]);
    useFakeSocket();

    renderPanel("running");
    await settle();

    expect(screen.getByText(HINT)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^implement/ }));
    });

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "implement inspector" }),
    ).toBeInTheDocument();
  });

  it("opens the running node's inspector without a click, and rings it in the graph", async () => {
    stubHistory([
      eventRow({ id: "1", nodeId: "implement", eventType: "init" }),
    ]);
    useFakeSocket();

    const { container } = renderPanel("running");

    await settle();

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "implement inspector" }),
    ).toBeInTheDocument();
    expect(
      container
        .querySelector('[data-node="implement"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps the clicked node selected when another node starts running", async () => {
    stubHistory([
      eventRow({ id: "1", nodeId: "implement", eventType: "init" }),
    ]);
    useFakeSocket();

    renderPanel("running");
    await settle();
    await selectNode("validate");
    await openChannels();
    await emitFrame({
      type: "agent_event",
      event: eventRow({
        id: "2",
        nodeId: "implement",
        eventType: "init",
      }) as never,
    });

    expect(
      screen.getByRole("region", { name: "validate inspector" }),
    ).toBeInTheDocument();
  });

  it("draws the model and duration line inside a visited node", async () => {
    stubHistory([
      eventRow({ id: "1", nodeId: "implement", eventType: "init" }),
    ]);
    useFakeSocket();

    const { container } = render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={definition}
        nodes={[walkRow({ outcome: "success", durationSeconds: 192 })]}
        repo="re-cinq/lore"
        reason={null}
        nodeModels={{
          implement: { model: "claude-sonnet-4-6", source: "recipe" },
        }}
      />,
    );

    await settle();

    expect(
      container.querySelector('[data-node="implement"] [data-meta]'),
    ).toHaveTextContent("Sonnet 4.6 · 3m 12s");
  });

  it("shows the selected node's pod logs inside the inspector, one panel per attempt", async () => {
    stubHistory([]);
    useFakeSocket();

    renderWithNodes([
      walkRow({ outcome: "implement-failed", agentCrName: "run1-implement" }),
      walkRow({ iteration: 2, agentCrName: "run1-implement-2" }),
      walkRow({ nodeId: "validate", agentCrName: "run1-validate" }),
    ]);
    await settle();
    await selectNode("implement");

    expect(screen.getByText("Pod logs · attempt 1")).toBeInTheDocument();
    expect(screen.getByText("Pod logs · attempt 2")).toBeInTheDocument();
    expect(screen.queryByText("Pod logs · attempt 3")).not.toBeInTheDocument();

    await selectNode("validate");

    expect(screen.getByText("Pod logs · attempt 1")).toBeInTheDocument();
    expect(screen.queryByText("Pod logs · attempt 2")).not.toBeInTheDocument();
  });

  it("renders the attempts history inside the inspector for a node that looped", async () => {
    stubHistory([]);
    useFakeSocket();

    renderWithNodes([
      walkRow({ outcome: "implement-failed" }),
      walkRow({ iteration: 2 }),
    ]);
    await settle();
    await selectNode("implement");

    expect(screen.getByText("Attempts (2)")).toBeInTheDocument();
  });

  it("renders the no-node-executions empty state instead of the hint for a run with no graph", async () => {
    stubHistory([]);
    useFakeSocket();

    render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={null}
        nodes={[]}
        repo="re-cinq/lore"
        reason={null}
      />,
    );
    await settle();

    expect(
      screen.getByText("No node executions recorded."),
    ).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});

describe("a node's input opens its transcript", () => {
  async function selectNode(name: string) {
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${name} —`) }),
      );
    });
  }

  const withInput = (input: AssemblyRunNode["input"]) => [
    {
      nodeId: "implement",
      iteration: 1,
      outcome: null,
      agentCrName: null,
      input,
      commitSha: null,
      durationSeconds: null,
    },
  ];

  it("shows the selected node's input card with the brief it was given", async () => {
    stubHistory([
      eventRow({ id: "1", nodeId: "implement", eventType: "init" }),
    ]);
    useFakeSocket();
    render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={definition}
        nodes={withInput({
          description: "implement the spec",
          prompt: "you are an implementer",
          params: null,
          repo: "re-cinq/lore",
          ref: "feat/x",
        })}
        repo="re-cinq/lore"
        reason={null}
      />,
    );
    await settle();
    await selectNode("implement");

    expect(screen.getAllByText("implement the spec").length).toBeGreaterThan(0);
  });

  it("shows a dispatched-but-silent node's input card", async () => {
    stubHistory([]);
    useFakeSocket();
    render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={definition}
        nodes={withInput({
          description: "implement the spec",
          prompt: null,
          params: null,
          repo: "re-cinq/lore",
          ref: "feat/x",
        })}
        repo="re-cinq/lore"
        reason={null}
      />,
    );
    await settle();
    await selectNode("implement");

    expect(screen.getAllByText("implement the spec").length).toBeGreaterThan(0);
  });

  it("renders no Input card for a pre-migration row that recorded none", async () => {
    stubHistory([]);
    useFakeSocket();
    render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={definition}
        nodes={withInput(null)}
        repo="re-cinq/lore"
        reason={null}
      />,
    );
    await settle();
    await selectNode("implement");

    expect(screen.queryByText("Input")).not.toBeInTheDocument();
  });
});

describe("retry from node", () => {
  function retryRow(over: Partial<AssemblyRunNode>): AssemblyRunNode {
    return {
      nodeId: "implement",
      iteration: 1,
      outcome: "success",
      agentCrName: null,
      commitSha: null,
      durationSeconds: 30,
      ...over,
    };
  }

  function renderRun(runStatus: string, nodes: AssemblyRunNode[]) {
    return render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus={runStatus}
        definition={definition}
        nodes={nodes}
        repo="re-cinq/lore"
        reason={null}
      />,
    );
  }

  async function select(name: string) {
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${name} —`) }),
      );
    });
  }

  it("offers Run this station on a node the run never visited, while the run is still live", async () => {
    stubHistory([]); // eslint-disable-line re-lint/declare-near-use -- the history stub must be installed before the render it serves

    useFakeSocket();
    renderRun("running", [retryRow({ nodeId: "implement", outcome: null })]);

    await settle();
    await select("validate");

    expect({
      run: screen.getByRole("button", { name: "Run this station" }) !== null,
      retry: screen.queryByRole("button", { name: "Retry from this node" }),
    }).toEqual({ run: true, retry: null });
  });

  it("offers retry in the node card's header on a finished run, posting the implement fork source", async () => {
    const fetchMock = stubHistory([]); // eslint-disable-line re-lint/declare-near-use -- the history stub must be installed before the render it serves

    useFakeSocket();

    const { container } = renderRun("finished", [
      retryRow({ nodeId: "implement" }),
      retryRow({ nodeId: "validate", outcome: "failed" }),
    ]);

    await settle();
    await select("validate");

    const button = screen.getByRole("button", {
      name: "Retry from this node",
    });

    expect(button.closest("summary")).toBe(
      container.querySelector("section summary"),
    );

    await act(async () => {
      fireEvent.click(button);
    });

    const rerunCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/assembly-runs/rerun",
    );
    const body = rerunCall?.[1]?.body as URLSearchParams;

    expect(rerunCall?.[1]).toMatchObject({ method: "POST" });
    expect(Object.fromEntries(body)).toEqual({
      run_id: "run-1",
      node_id: "implement",
      iteration: "1",
    });
  });

  it("offers retry on a looping run's validate node, posting implement@2 as the fork source", async () => {
    const fetchMock = stubHistory([]);

    useFakeSocket();

    renderRun("failed", [
      retryRow({ nodeId: "implement", iteration: 1 }),
      retryRow({ nodeId: "validate", iteration: 1, outcome: "failed" }),
      retryRow({ nodeId: "implement", iteration: 2 }),
      retryRow({ nodeId: "validate", iteration: 2, outcome: "failed" }),
    ]);

    await settle();
    await select("validate");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Retry from this node" }),
      );
    });

    const rerunCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/assembly-runs/rerun",
    );

    expect(Object.fromEntries(rerunCall?.[1]?.body as URLSearchParams)).toEqual(
      {
        run_id: "run-1",
        node_id: "implement",
        iteration: "2",
      },
    );
  });

  it("offers no retry while the run is still running", async () => {
    stubHistory([]);
    useFakeSocket();

    renderRun("running", [
      retryRow({ nodeId: "implement" }),
      retryRow({ nodeId: "validate", outcome: "failed" }),
    ]);

    await settle();
    await select("validate");

    expect(
      screen.queryByRole("button", { name: "Retry from this node" }),
    ).not.toBeInTheDocument();
  });

  it("offers no retry on the entry node — there is no prefix to fork from", async () => {
    stubHistory([]);
    useFakeSocket();

    renderRun("finished", [
      retryRow({ nodeId: "implement", outcome: "failed" }),
    ]);

    await settle();
    await select("implement");

    expect(
      screen.queryByRole("button", { name: "Retry from this node" }),
    ).not.toBeInTheDocument();
  });
});

describe("agent edit link", () => {
  function renderWithHrefs(nodes: AssemblyRunNode[]) {
    return render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={definition}
        nodes={nodes}
        repo="re-cinq/lore"
        reason={null}
        agentEditHrefs={{
          implement: "/repos/re-cinq/lore/agents/implement/edit",
        }}
      />,
    );
  }

  const row = (nodeId: string): AssemblyRunNode => ({
    nodeId,
    iteration: 1,
    outcome: null,
    agentCrName: null,
    commitSha: null,
    durationSeconds: 10,
  });

  async function select(name: string) {
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${name} —`) }),
      );
    });
  }

  it("links an agent node's card header to its resolved agents editor, live run included", async () => {
    stubHistory([]);
    useFakeSocket();

    const { container } = renderWithHrefs([row("implement")]);

    await settle();
    await select("implement");

    const link = screen.getByRole("link", { name: "Edit agent" });

    expect(link).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore/agents/implement/edit",
    );
    expect(link.closest("summary")).toBe(
      container.querySelector("section summary"),
    );
  });

  it("offers no edit link on a node the href map does not name", async () => {
    stubHistory([]);
    useFakeSocket();

    renderWithHrefs([row("implement"), row("validate")]);

    await settle();
    await select("validate");

    expect(
      screen.queryByRole("link", { name: "Edit agent" }),
    ).not.toBeInTheDocument();
  });
});

describe("file diff drawer", () => {
  it("mounts the drawer titled with the touched file when its heatmap bar is clicked", async () => {
    stubHistory([
      eventRow({
        id: "2",
        nodeId: "implement",
        eventType: "tool_call",
        toolName: "Edit",
        filePaths: ["src/a.ts"],
      }),
    ]);
    useFakeSocket();

    const { container } = render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="finished"
        definition={definition}
        nodes={[]}
        repo="re-cinq/lore"
        reason={null}
        prNumber={42}
      />,
    );

    await settle();
    await act(async () => {
      fireEvent.click(
        container.querySelector("[data-path='src/a.ts']") as HTMLElement,
      );
    });

    expect(screen.getByText("Diff · src/a.ts")).toBeInTheDocument();
  });
});
