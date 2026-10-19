// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import RunVisualizationPanel from "./RunVisualizationPanel";
import RunBagFacts from "./RunBagFacts";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { codeReviewDefinition } from "@/lib/definition-fixtures";
import { HISTORY_PAGE_LIMIT } from "@/lib/run-stream-presenter";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";
import type { RunStreamFrame } from "@/lib/run-stream-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

  it("shows the newest attempt's pod logs alone once Pod logs is chosen", async () => {
    stubHistory([]);
    useFakeSocket();

    renderWithNodes([
      walkRow({ outcome: "implement-failed", agentCrName: "run1-implement" }),
      walkRow({ iteration: 2, agentCrName: "run1-implement-2" }),
      walkRow({ nodeId: "validate", agentCrName: "run1-validate" }),
    ]);
    await settle();
    await selectNode("implement");
    fireEvent.change(screen.getByLabelText("Show"), {
      target: { value: "pods" },
    });

    expect(screen.getByText("Pod logs · attempt 2")).toBeInTheDocument();
    expect(screen.queryByText("Pod logs · attempt 1")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Transcript", { selector: "strong" }),
    ).not.toBeInTheDocument();
  });

  it("shows attempt 1's pod logs when the attempt select picks it", async () => {
    stubHistory([]);
    useFakeSocket();

    renderWithNodes([
      walkRow({ outcome: "implement-failed", agentCrName: "run1-implement" }),
      walkRow({ iteration: 2, agentCrName: "run1-implement-2" }),
    ]);
    await settle();
    await selectNode("implement");
    fireEvent.change(screen.getByLabelText("Show"), {
      target: { value: "pods" },
    });
    fireEvent.change(screen.getByLabelText("Attempt"), {
      target: { value: "1" },
    });

    expect(screen.getByText("Pod logs · attempt 1")).toBeInTheDocument();
  });

  it("draws the header above the graph, the run details under it and the task notice after the attempt, outside the aside", async () => {
    stubHistory([]);
    useFakeSocket();

    const { container } = render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={definition}
        nodes={[walkRow({})]}
        repo="re-cinq/lore"
        reason={null}
        header={<p>header slot</p>}
        runDetails={<p>details slot</p>}
        taskContext={<p>task slot</p>}
      />,
    );

    await settle();
    await selectNode("implement");

    const order = [
      screen.getByText("header slot"),
      container.querySelector('[data-node="implement"]'),
      screen.getByText("details slot"),
      screen.getByLabelText("Show"),
      screen.getByText("task slot"),
    ];
    const aside = screen.getByRole("complementary", { name: "Selected node" });

    expect({
      inReadingOrder: order.every(
        (node, i) =>
          i === 0 ||
          Boolean(
            order[i - 1]!.compareDocumentPosition(node as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
      ),
      inAside: order.map((node) => aside.contains(node as Node)),
    }).toEqual({
      inReadingOrder: true,
      inAside: [false, false, false, false, false],
    });
  });

  it("keeps Pod logs chosen across a trip to another node and back", async () => {
    stubHistory([]);
    useFakeSocket();

    renderWithNodes([
      walkRow({ agentCrName: "run1-implement" }),
      walkRow({ nodeId: "validate", agentCrName: "run1-validate" }),
    ]);
    await settle();
    await selectNode("implement");
    fireEvent.change(screen.getByLabelText("Show"), {
      target: { value: "pods" },
    });
    await selectNode("validate");
    await selectNode("implement");

    expect(screen.getByLabelText("Show")).toHaveValue("pods");
  });

  it("moves the attempt select to attempt 1 when its row in the detail card is clicked", async () => {
    stubHistory([]);
    useFakeSocket();

    renderWithNodes([
      walkRow({ outcome: "implement-failed" }),
      walkRow({ iteration: 2 }),
    ]);
    await settle();
    await selectNode("implement");
    fireEvent.click(screen.getByRole("button", { name: /^attempt 1/ }));

    expect(screen.getByLabelText("Attempt")).toHaveValue("1");
  });

  it("shows the attempt's needs card with the bag it was handed", async () => {
    stubHistory([]);
    useFakeSocket();

    renderWithNodes([
      walkRow({ needs: { target: "github.com/re-cinq/lore@main" } }),
    ]);
    await settle();
    await selectNode("implement");

    expect(screen.getByText("Needs")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "github.com/re-cinq/lore@main" }),
    ).toHaveAttribute("href", "https://github.com/re-cinq/lore/tree/main");
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

describe("Run this station", () => {
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

  const floorDefinition: AssemblyLineDefinition = {
    ...definition,
    fail: "gave-up",
    nodes: [...definition.nodes, { id: "gave-up", type: "retrospective" }],
  };

  function renderRun(
    runStatus: string,
    nodes: AssemblyRunNode[],
    engine?: string,
  ) {
    return render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus={runStatus}
        definition={floorDefinition}
        nodes={nodes}
        repo="re-cinq/lore"
        reason={null}
        engine={engine}
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

  it("offers neither retry nor Run this station on a node of a finished run Lore's own engine walked", async () => {
    stubHistory([]);
    useFakeSocket();

    renderRun("finished", [
      retryRow({ nodeId: "implement" }),
      retryRow({ nodeId: "validate", outcome: "failed" }),
    ]);

    await settle();
    await select("implement");

    expect({
      retry: screen.queryByRole("button", { name: "Retry from this node" }),
      run: screen.queryByRole("button", { name: "Run this station" }),
    }).toEqual({ retry: null, run: null });
  });

  it("offers Run this station on implement, a node of a finished floor run", async () => {
    stubHistory([]);
    useFakeSocket();

    renderRun("finished", [retryRow({ nodeId: "implement" })], "floor");

    await settle();
    await select("implement");

    expect(
      screen.getByRole("button", { name: "Run this station" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["validate", "the exit"],
    ["gave-up", "the fail node"],
  ])("offers no Run this station on %s, %s of a floor run", async (nodeId) => {
    stubHistory([]);
    useFakeSocket();

    renderRun("finished", [retryRow({ nodeId })], "floor");

    await settle();
    await select(nodeId);

    expect(
      screen.queryByRole("button", { name: "Run this station" }),
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
      container.querySelector('[aria-label="implement inspector"] summary'),
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

  async function renderWithTouchedFile() {
    stubHistory([
      eventRow({
        id: "2",
        nodeId: "implement",
        eventType: "tool_call",
        toolName: "Edit",
        filePaths: ["src/a.ts"],
      }),
    ]);
    FakeWebSocket.reset();

    const view = render(
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

    return view;
  }

  it("draws the Files touched card inside the selected-node aside", async () => {
    await renderWithTouchedFile();

    expect(
      screen.getByRole("complementary", { name: "Selected node" }),
    ).toContainElement(screen.getByText("Files touched"));
  });

  it("mounts the clicked file's diff outside the aside, in the center column", async () => {
    const { container } = await renderWithTouchedFile();

    await act(async () => {
      fireEvent.click(
        container.querySelector("[data-path='src/a.ts']") as HTMLElement,
      );
    });

    expect(
      screen.getByRole("complementary", { name: "Selected node" }),
    ).not.toContainElement(screen.getByText("Diff · src/a.ts"));
  });
});

describe("a run that ended", () => {
  function renderEnded(
    runStatus: string,
    runOutcome: string | null,
    reason: string | null,
  ) {
    return render(
      <LiveSocketProvider url="ws://test/api/ws" socket={FakeWebSocket}>
        <RunVisualizationPanel
          runId="run-1"
          runStatus={runStatus}
          runOutcome={runOutcome}
          definition={definition}
          nodes={[]}
          repo="re-cinq/lore"
          reason={reason}
        />
      </LiveSocketProvider>,
    );
  }

  it("labels the chip Cancelled for a finished run whose outcome is cancelled", async () => {
    stubHistory([]);
    useFakeSocket();

    renderEnded("finished", "cancelled", null);
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("Cancelled");
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("labels the chip Failed for a failed run", async () => {
    stubHistory([]);
    useFakeSocket();

    renderEnded("failed", "failed", null);
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("Failed");
  });

  it("says no step ran and quotes the reason for a run with a graph and no node rows, offering no outcomes toggle", async () => {
    stubHistory([]);
    useFakeSocket();

    renderEnded(
      "finished",
      "cancelled",
      "merged back into run 01750e85 (Run this station now runs in the same run)",
    );
    await settle();

    expect(screen.getByRole("note")).toHaveTextContent(
      "No step ran in this run. merged back into run 01750e85 (Run this station now runs in the same run)",
    );
    expect(
      screen.queryByRole("button", { name: "Show possible outcomes" }),
    ).not.toBeInTheDocument();
  });
});

describe("the attempt column by station kind", () => {
  const kindDefinition: AssemblyLineDefinition = {
    name: "planning",
    description: "draft, ground, approve",
    version: 1,
    entry: "draft",
    exit: "done",
    nodes: [
      { id: "draft", type: "agent" },
      { id: "ground", type: "validate" },
      { id: "approve", type: "pr_review" },
      { id: "done", type: "retrospective" },
    ],
    edges: [
      { from: "draft", to: "ground", on: "success" },
      { from: "ground", to: "approve", on: "success" },
      { from: "approve", to: "done", on: "success" },
    ],
  };

  function visitRow(over: Partial<AssemblyRunNode>): AssemblyRunNode {
    return {
      nodeId: "draft",
      iteration: 1,
      outcome: "success",
      agentCrName: null,
      commitSha: null,
      durationSeconds: 30,
      ...over,
    };
  }

  async function renderAndSelect(nodes: AssemblyRunNode[], nodeId: string) {
    stubHistory([]);
    FakeWebSocket.reset();
    render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={kindDefinition}
        nodes={nodes}
        repo="re-cinq/lore"
        reason={null}
        engine="floor"
      />,
    );
    await settle();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${nodeId} —`) }),
      );
    });
  }

  it("shows ground, a service node, its error in an Outcome card and no Show select", async () => {
    await renderAndSelect(
      [
        visitRow({
          nodeId: "ground",
          outcome: "failed",
          failureDetail: "the plan names a file main does not have",
          agentCrName: "floor-visit-2",
        }),
      ],
      "ground",
    );

    expect({
      show: screen.queryByLabelText("Show"),
      error: screen.getByText("the plan names a file main does not have")
        .textContent,
    }).toEqual({
      show: null,
      error: "the plan names a file main does not have",
    });
  });

  it("shows approve, waiting on a person, as Waiting for the spec PR with Open the pull request", async () => {
    await renderAndSelect(
      [
        visitRow({
          nodeId: "approve",
          outcome: null,
          routeUrl: "https://github.com/re-cinq/lore/pull/412",
        }),
      ],
      "approve",
    );

    expect({
      waiting: screen.getAllByText("Waiting for the spec PR").length > 0,
      open: screen
        .getByRole("link", { name: "Open the pull request" })
        .getAttribute("href"),
    }).toEqual({
      waiting: true,
      open: "https://github.com/re-cinq/lore/pull/412",
    });
  });

  it("shows a Produced card for a draft attempt that produced plan", async () => {
    await renderAndSelect(
      [
        visitRow({
          produced: { plan: "plan text" },
          agentCrName: "floor-visit-1",
        }),
      ],
      "draft",
    );

    expect({
      show: screen.getByLabelText("Show") !== null,
      produced: screen.getByText("Produced") !== null,
    }).toEqual({ show: true, produced: true });
  });

  it("offers no Run this station on approve, which a person answers", async () => {
    await renderAndSelect(
      [visitRow({ nodeId: "approve", outcome: null })],
      "approve",
    );

    expect(
      screen.queryByRole("button", { name: "Run this station" }),
    ).not.toBeInTheDocument();
  });
});

describe("the bag names who put an item there", () => {
  const implementAttempt = (iteration: number): AssemblyRunNode => ({
    nodeId: "implement",
    iteration,
    outcome: "success",
    agentCrName: null,
    commitSha: null,
    durationSeconds: 30,
    stationRunId: `visit-${iteration}`,
  });

  it("shows implement's attempt 1 in the center once implement · attempt 1 is clicked in the bag", async () => {
    stubHistory([]);
    useFakeSocket();
    const nodes = [implementAttempt(1), implementAttempt(2)];
    const bag = {
      plan: { kind: "value", ref: "plan-7", by: "visit-1" },
    } as const;

    render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        definition={definition}
        nodes={nodes}
        repo="re-cinq/lore"
        reason={null}
        runDetails={<RunBagFacts runId="run-1" bag={bag} nodes={nodes} />}
      />,
    );
    await settle();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "implement · attempt 1" }),
      );
    });

    expect(screen.getByLabelText("Attempt")).toHaveValue("1");
  });
});
