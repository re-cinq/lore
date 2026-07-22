// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import RunVisualizationPanel from "./RunVisualizationPanel";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import { codeReviewDefinition } from "@/lib/builtin-definitions";
import { HISTORY_PAGE_LIMIT } from "./run-stream-presenter";

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

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (e: MessageEvent) => void>();
  closed = false;
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

  close() {
    this.closed = true;
  }

  emit(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

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

function useFakeEventSource() {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
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
    <RunVisualizationPanel
      runId="run-1"
      runStatus={runStatus}
      startedAt={null}
      definition={definition}
      showEdgeLabels
      nodes={[]}
      repo="re-cinq/lore"
      reason={null}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("stream lifecycle", () => {
  it("constructs no EventSource for a finished run", async () => {
    stubHistory([]);
    useFakeEventSource();

    renderPanel("finished");
    await settle();

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("constructs one EventSource for a running run", async () => {
    stubHistory([]);
    useFakeEventSource();

    renderPanel("running");
    await settle();

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("opens the EventSource only after the history fold sets lastEventId", async () => {
    stubHistory([eventRow({ id: "7" })]);
    useFakeEventSource();

    renderPanel("running");
    await settle();

    expect(FakeEventSource.instances[0].url).toContain("after=7");
  });

  it("closes the EventSource on unmount", async () => {
    stubHistory([]);
    useFakeEventSource();

    const view = renderPanel("running");

    await settle();
    view.unmount();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("constructs no EventSource when globalThis.EventSource is undefined", async () => {
    stubHistory([]);
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", undefined);

    renderPanel("running");
    await settle();

    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

describe("history fold", () => {
  it("renders the node status from a folded history event", async () => {
    stubHistory([eventRow({ id: "3", eventType: "init" })]);
    useFakeEventSource();

    renderPanel("running");
    await settle();

    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("pages history until a page shorter than the limit arrives", async () => {
    const fullPage = Array.from({ length: HISTORY_PAGE_LIMIT }, (_, i) =>
      eventRow({ id: String(i + 1) }),
    );
    const fetchMock = stubHistory(fullPage, [eventRow({ id: "1001" })]);

    useFakeEventSource();

    renderPanel("running");
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `after=${HISTORY_PAGE_LIMIT}`,
    );
  });

  it("renders the graph and folded history when EventSource is undefined", async () => {
    stubHistory([eventRow({ id: "3" })]);
    vi.stubGlobal("EventSource", undefined);

    renderPanel("running");
    await settle();

    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });
});

describe("degradation", () => {
  it("renders the seeded graph with an offline label when the history fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    useFakeEventSource();

    renderPanel("running");
    await settle();

    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("renders the graph without a rejected promise when the stream proxy returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Run not found" }),
      }),
    );
    useFakeEventSource();

    renderPanel("running");
    await settle();

    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

describe("live events", () => {
  it("applies an agent-event message to the graph", async () => {
    stubHistory([]);
    useFakeEventSource();

    renderPanel("running");
    await settle();

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "agent-event",
        eventRow({ id: "9", nodeId: "validate", eventType: "init" }),
      );
    });

    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("does not rebuild the EventSource when a live event updates afterId", async () => {
    stubHistory([]);
    useFakeEventSource();

    renderPanel("running");
    await settle();

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "agent-event",
        eventRow({ id: "42", nodeId: "implement", eventType: "init" }),
      );
    });

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe("node transcript drill-in", () => {
  async function selectNode(name: string) {
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${name} —`) }),
      );
    });
  }

  it("shows the implement node transcript after clicking the implement node", async () => {
    stubHistory([
      eventRow({ id: "1", nodeId: "implement", eventType: "init" }),
      eventRow({
        id: "2",
        nodeId: "implement",
        eventType: "tool_call",
        toolName: "Edit",
        summary: "spec.md",
      }),
    ]);
    useFakeEventSource();

    renderPanel("running");
    await settle();
    await selectNode("implement");

    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("spec.md")).toBeInTheDocument();
  });

  it("swaps to the validate node transcript when the selection changes", async () => {
    stubHistory([
      eventRow({
        id: "1",
        nodeId: "implement",
        eventType: "tool_call",
        toolName: "Edit",
        summary: "spec.md",
      }),
      eventRow({
        id: "2",
        nodeId: "validate",
        eventType: "tool_call",
        toolName: "Bash",
        summary: "npm test",
      }),
    ]);
    useFakeEventSource();

    renderPanel("running");
    await settle();
    await selectNode("implement");
    await selectNode("validate");

    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.queryByText("spec.md")).not.toBeInTheDocument();
  });

  it("renders the empty transcript message for a node with no events", async () => {
    stubHistory([]);
    useFakeEventSource();

    // A walk row makes the node participate (so it renders and is selectable)
    // while its transcript stays empty.
    render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="running"
        startedAt={null}
        definition={definition}
        showEdgeLabels
        nodes={[
          {
            nodeId: "implement",
            iteration: 1,
            outcome: null,
            agentCrName: null,
            commitSha: null,
            durationSeconds: null,
          },
        ]}
        repo="re-cinq/lore"
        reason={null}
      />,
    );
    await settle();
    await selectNode("implement");

    expect(
      screen.getByText("No agent events for implement yet."),
    ).toBeInTheDocument();
  });

  it("appends a live tool_call row to the open transcript", async () => {
    stubHistory([
      eventRow({ id: "1", nodeId: "implement", eventType: "init" }),
    ]);
    useFakeEventSource();

    renderPanel("running");
    await settle();
    await selectNode("implement");

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "agent-event",
        eventRow({
          id: "9",
          nodeId: "implement",
          eventType: "tool_call",
          toolName: "Bash",
          summary: "npm run build",
        }),
      );
    });

    expect(screen.getByText("npm run build")).toBeInTheDocument();
  });

  it("keeps the transcript scroll handler working when the reader scrolls", async () => {
    stubHistory([
      eventRow({
        id: "1",
        nodeId: "implement",
        eventType: "message",
        summary: "alpha",
      }),
    ]);
    useFakeEventSource();

    const view = renderPanel("running");

    await settle();
    await selectNode("implement");

    const box = view.container.querySelector("div[class*='transcriptScroll']");

    expect(box).not.toBeNull();

    await act(async () => {
      box?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});

describe("heatmap and timeline wiring", () => {
  it("grows the file heatmap as tool call events stream in and mounts the timeline", async () => {
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
    useFakeEventSource();

    const { container } = renderPanel("running");

    await settle();

    expect(container.querySelectorAll("[data-path]")).toHaveLength(1);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-tone]").length).toBeGreaterThan(0);

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "agent-event",
        eventRow({
          id: "9",
          nodeId: "implement",
          eventType: "tool_call",
          toolName: "Edit",
          filePaths: ["src/b.ts"],
        }),
      );
    });

    expect(container.querySelectorAll("[data-path]")).toHaveLength(2);
  });

  it("ticks a live run's clock forward on an interval so a stalled timeline advances", () => {
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

describe("replay scrubber", () => {
  const runLoop = [
    eventRow({ id: "1", nodeId: "implement", eventType: "init" }),
    eventRow({ id: "2", nodeId: "implement", eventType: "result" }),
    eventRow({ id: "3", nodeId: "validate", eventType: "init" }),
    eventRow({ id: "4", nodeId: "validate", eventType: "result" }),
  ];

  const nodeStatus = (container: HTMLElement, nodeId: string) =>
    container.querySelector(`[data-node="${nodeId}"]`)?.textContent ?? "";

  async function scrubTo(cursor: number) {
    await act(async () => {
      fireEvent.change(screen.getByRole("slider"), {
        target: { value: String(cursor) },
      });
    });
  }

  it("shows the scrubber for a finished run with persisted events", async () => {
    stubHistory([eventRow({ id: "1", eventType: "init" })]);
    useFakeEventSource();

    renderPanel("finished");
    await settle();

    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("hides the scrubber for a running run", async () => {
    stubHistory([eventRow({ id: "1", eventType: "init" })]);
    useFakeEventSource();

    renderPanel("running");
    await settle();

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("hides the scrubber for a finished run with no persisted events", async () => {
    stubHistory([]);
    useFakeEventSource();

    renderPanel("finished");
    await settle();

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("seeking to mid-run shows the running node and hides steps that have not run", async () => {
    stubHistory(runLoop);
    useFakeEventSource();

    const { container } = renderPanel("finished");

    await settle();
    await scrubTo(1);

    expect(nodeStatus(container, "implement")).toContain("Running");
    // validate has not participated at this cursor — run mode does not draw it.
    expect(container.querySelector('[data-node="validate"]')).toBeNull();
  });

  it("moves the scrubber to the event a timeline tick seeks to", async () => {
    stubHistory(runLoop);
    useFakeEventSource();

    renderPanel("finished");
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTitle("validate init"));
    });

    expect(screen.getByRole("slider")).toHaveValue("3");
  });

  it("clears the replay cursor and restores the final state on back to live", async () => {
    stubHistory(runLoop);
    useFakeEventSource();

    const { container } = renderPanel("finished");

    await settle();
    await scrubTo(1);

    expect(container.querySelector('[data-node="validate"]')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /back to live/i }));
    });

    // Final state: implement carries its verdict, the terminal the run result.
    expect(nodeStatus(container, "implement")).toContain("Succeeded");
    expect(nodeStatus(container, "validate")).toContain("Completed");
  });
});

describe("run-graph verdict on a finished run (regression)", () => {
  const nodeTone = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-node="${id}"]`)?.getAttribute("data-tone");
  const nodeText = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-node="${id}"]`)?.textContent ?? "";

  it("shows a failed review's verdict, not its clean pod exit, and a failed terminal", async () => {
    // The exact production bug: a finished code-review run whose review pod
    // exited 0 (a benign `result` event → status succeeded) but whose recorded
    // verdict is failed. The verdict comes from the walk row, so the graph must
    // read Failed, not the green execution status; the terminal shows the run
    // result (Failed), not "Completed" derived from the `finished` status.
    stubHistory([
      eventRow({ id: "1", nodeId: "review", eventType: "init" }),
      eventRow({
        id: "2",
        nodeId: "review",
        eventType: "result",
        isError: false,
      }),
    ]);
    useFakeEventSource();

    const { container } = render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="finished"
        startedAt={null}
        definition={codeReviewDefinition}
        showEdgeLabels
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

describe("replay rewinds the run graph (regression)", () => {
  // The finished #927 fixture WITH walk rows: the recorded verdicts exist from
  // the first render, but scrubbing must gate them behind the replayed cursor.
  const reviewNodes = [
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
  ];
  const reviewHistory = [
    eventRow({ id: "1", nodeId: "review", eventType: "init" }),
    eventRow({
      id: "2",
      nodeId: "review",
      eventType: "result",
      isError: false,
    }),
    eventRow({ id: "3", nodeId: "done", eventType: "init" }),
    eventRow({ id: "4", nodeId: "done", eventType: "result", isError: false }),
  ];

  function renderReviewRun() {
    return render(
      <RunVisualizationPanel
        runId="run-1"
        runStatus="finished"
        startedAt={null}
        definition={codeReviewDefinition}
        showEdgeLabels
        nodes={reviewNodes}
        repo="re-cinq/lore"
        reason={'node "review" failed'}
      />,
    );
  }

  async function scrubTo(cursor: number) {
    await act(async () => {
      fireEvent.change(screen.getByRole("slider"), {
        target: { value: String(cursor) },
      });
    });
  }

  const nodeText = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-node="${id}"]`)?.textContent ?? "";

  it("shows no verdict badges, no nodes and no taken path at cursor zero", async () => {
    stubHistory(reviewHistory);
    useFakeEventSource();

    const { container } = renderReviewRun();

    await settle();
    await scrubTo(0);

    expect(container.querySelector('[data-node="review"]')).toBeNull();
    expect(container.querySelector('[data-node="done"]')).toBeNull();
    expect(container.querySelector("[data-edge]")).toBeNull();
  });

  it("holds the recorded verdict back while the node is still running at the cursor", async () => {
    stubHistory(reviewHistory);
    useFakeEventSource();

    const { container } = renderReviewRun();

    await settle();
    await scrubTo(1);

    expect(nodeText(container, "review")).toContain("Running");
    expect(nodeText(container, "review")).not.toContain("Failed");
    // Unreached at this cursor: no taken edge yet, so done is not drawn.
    expect(container.querySelector('[data-node="done"]')).toBeNull();
  });

  it("shows the walk row's failed verdict, not the clean pod exit, once the result replays", async () => {
    stubHistory(reviewHistory);
    useFakeEventSource();

    const { container } = renderReviewRun();

    await settle();
    await scrubTo(2);

    expect(nodeText(container, "review")).toContain("Failed");
    expect(nodeText(container, "review")).not.toContain("Succeeded");
    expect(
      container
        .querySelector('[data-node="review"]')
        ?.getAttribute("data-tone"),
    ).toBe("err");
  });

  it("renders the max cursor identically to back to live", async () => {
    stubHistory(reviewHistory);
    useFakeEventSource();

    const { container } = renderReviewRun();

    await settle();
    await scrubTo(reviewHistory.length);

    const atMax = {
      review: nodeText(container, "review"),
      done: nodeText(container, "done"),
    };

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /back to live/i }));
    });

    expect(atMax.review).toContain("Failed");
    expect(atMax.done).toContain("Failed");
    expect(atMax).toEqual({
      review: nodeText(container, "review"),
      done: nodeText(container, "done"),
    });
  });
});

describe("stream give-up and history polling", () => {
  async function failStream(times: number) {
    for (let i = 0; i < times; i++) {
      const source =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      await act(async () => {
        source.onerror?.(new Event("error"));
        vi.advanceTimersByTime(16000);
      });
    }
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes offline for good after six consecutive stream errors", async () => {
    vi.useFakeTimers();
    stubHistory([]);
    useFakeEventSource();

    renderPanel("running");
    await settle();
    await failStream(6);

    expect(FakeEventSource.instances).toHaveLength(6);
    expect(
      FakeEventSource.instances[FakeEventSource.instances.length - 1].closed,
    ).toBe(true);
    expect(screen.getByText("Offline")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(FakeEventSource.instances).toHaveLength(6);
  });

  it("polls the history proxy from the reducer cursor after giving up and applies new rows", async () => {
    vi.useFakeTimers();
    const fetchMock = stubHistory([
      eventRow({ id: "5", nodeId: "implement", eventType: "init" }),
    ]);

    useFakeEventSource();

    const { container } = renderPanel("running");

    await settle();
    await failStream(6);

    expect(container.querySelector('[data-node="validate"]')).toBeNull();

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
