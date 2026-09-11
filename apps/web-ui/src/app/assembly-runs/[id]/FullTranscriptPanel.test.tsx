// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import FullTranscriptPanel from "./FullTranscriptPanel";
import {
  MAX_TURNS_LOADED,
  MAX_WALK_PAGES,
  TURNS_PAGE_LIMIT,
} from "./turn-transcript-presenter";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function wireTurn(id: string, nodeId: string | null, iteration = 1) {
  return {
    id,
    taskId: "task-1",
    agentCrName: nodeId === null ? null : `cr-${nodeId}`,
    assemblyLineId: "run-1",
    nodeId,
    iteration: nodeId === null ? null : iteration,
    eventType: "assistant",
    envelope: {
      source: { task: "task-1" },
      event: {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: `full text of turn ${id}` }],
        },
      },
    },
    createdAt: "2026-08-12T10:00:00.000Z",
  };
}

function fullPage(startAt: number, nodeId: string) {
  return Array.from({ length: TURNS_PAGE_LIMIT }, (_, i) =>
    wireTurn(String(startAt + i), nodeId),
  );
}

function turnsResponse(turns: unknown[]) {
  return new Response(JSON.stringify({ turns }), { status: 200 });
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();

  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function closeDetails(container: HTMLElement) {
  const details = detailsOf(container);

  details.open = false;
  fireEvent(details, new Event("toggle"));
}

async function openPanel(container: HTMLElement) {
  openDetails(container);

  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function openDetails(container: HTMLElement) {
  const details = detailsOf(container);

  details.open = true;
  fireEvent(details, new Event("toggle"));
}

function detailsOf(container: HTMLElement): HTMLDetailsElement {
  const details = container.querySelector("details");

  if (!details) {
    throw new Error("panel not rendered");
  }

  return details;
}

describe("FullTranscriptPanel", () => {
  it("renders open and starts the walk on mount, before any click", () => {
    const fetchMock = stubFetch(turnsResponse([]));

    render(<FullTranscriptPanel runId="run-1" nodeId="implement" />);

    expect(screen.getByText("Transcript")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches the run's turns once opened and renders the assistant text, formatted", async () => {
    stubFetch(turnsResponse([wireTurn("1", "implement")]));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(await screen.findByText(/full text of turn 1/)).toBeTruthy();
  });

  it("offers no raw view, showing the formatted conversation alone", async () => {
    stubFetch(turnsResponse([wireTurn("1", "implement")]));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);
    await screen.findByText(/full text of turn 1/);

    expect(screen.queryByRole("button", { name: "Raw" })).toBeNull();
  });

  it("pages with the cursor until a short page", async () => {
    const fetchMock = stubFetch(
      turnsResponse(fullPage(1, "implement")),
      turnsResponse([wireTurn(String(TURNS_PAGE_LIMIT + 1), "implement")]),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `after=${TURNS_PAGE_LIMIT}`,
    );
  }, 15_000);

  it("stops the walk at the load cap and says so, instead of loading unbounded turns", async () => {
    const fetchMock = stubFetch(
      turnsResponse(fullPage(1, "other")),
      turnsResponse(fullPage(TURNS_PAGE_LIMIT + 1, "other")),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(fetchMock).toHaveBeenCalledTimes(
      MAX_TURNS_LOADED / TURNS_PAGE_LIMIT,
    );
    expect(
      await screen.findByText(new RegExp(`first ${MAX_TURNS_LOADED} turns`)),
    ).toBeTruthy();
  });

  it("shows only the selected node's turns", async () => {
    stubFetch(
      turnsResponse([wireTurn("1", "implement"), wireTurn("2", "review")]),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(await screen.findByText(/full text of turn 1/)).toBeTruthy();
    expect(screen.queryByText(/full text of turn 2/)).toBeNull();
  });

  it("labels a turn with its iteration, so a revisited node's attempts stay distinguishable", async () => {
    stubFetch(turnsResponse([wireTurn("1", "implement", 2)]));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(await screen.findByText(/iteration 2/)).toBeTruthy();
  });

  it("switching nodes refilters without refetching", async () => {
    const fetchMock = stubFetch(
      turnsResponse([wireTurn("1", "implement"), wireTurn("2", "review")]),
    );
    const { container, rerender } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);
    rerender(<FullTranscriptPanel runId="run-1" nodeId="review" />);

    expect(await screen.findByText(/full text of turn 2/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reopening while the first walk is in flight never starts a second one", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));

    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);
    closeDetails(container);
    await openPanel(container);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an empty message for a node with no stored turns", async () => {
    stubFetch(turnsResponse([]));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(
      await screen.findByText(/No stored turns for implement/),
    ).toBeTruthy();
  });

  it("surfaces a fetch failure instead of an empty transcript", async () => {
    stubFetch(new Response("{}", { status: 500 }));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(await screen.findByText(/Failed to load turns/)).toBeTruthy();
  });

  it("a failed walk retries when the panel is reopened", async () => {
    stubFetch(
      new Response("{}", { status: 500 }),
      turnsResponse([wireTurn("1", "implement")]),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);
    expect(await screen.findByText(/Failed to load turns/)).toBeTruthy();

    closeDetails(container);
    await openPanel(container);

    expect(await screen.findByText(/full text of turn 1/)).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("a reopened retry shows Loading instead of the stale error", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);
    expect(await screen.findByText(/Failed to load turns/)).toBeTruthy();

    closeDetails(container);
    await openPanel(container);

    expect(screen.queryByText(/Failed to load turns/)).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});

function turnsPageResponse(
  turns: unknown[],
  { hasMore }: { hasMore: boolean },
) {
  return new Response(JSON.stringify({ turns, hasMore }), { status: 200 });
}

async function openPanelLong(container: HTMLElement) {
  openDetails(container);

  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("FullTranscriptPanel with the Floor's hasMore flag", () => {
  it("keeps walking across a short page while the Floor reports more", async () => {
    const fetchMock = stubFetch(
      turnsPageResponse(
        [wireTurn("1", "implement"), wireTurn("2", "implement")],
        { hasMore: true },
      ),
      turnsPageResponse([wireTurn("3", "implement")], { hasMore: false }),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("after=2");
    expect(await screen.findByText(/full text of turn 3/)).toBeTruthy();
  });

  it("stops walking on a full page when the Floor reports no more", async () => {
    const fetchMock = stubFetch(
      turnsPageResponse(fullPage(1, "implement"), { hasMore: false }),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("stops paging when the Floor reports more but the page carries no usable cursor, and says so", async () => {
    const fetchMock = stubFetch(
      turnsPageResponse([{ id: 7 }, {}] as unknown[], { hasMore: true }),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Loaded only the first 0 turns/),
    ).toBeTruthy();
  });

  it("stops a drifted walk at the page bound and shows the cap notice", async () => {
    const responses = Array.from({ length: MAX_WALK_PAGES + 5 }, (_, i) =>
      turnsPageResponse([wireTurn(String(i + 1), "implement")], {
        hasMore: true,
      }),
    );
    const fetchMock = stubFetch(...responses);
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanelLong(container);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_WALK_PAGES);
    expect(
      await screen.findByText(new RegExp(`first ${MAX_WALK_PAGES} turns`)),
    ).toBeTruthy();
  });

  it("shows the cap notice when the Floor reports more over an empty page", async () => {
    const fetchMock = stubFetch(turnsPageResponse([], { hasMore: true }));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Loaded only the first 0 turns/),
    ).toBeTruthy();
  });

  it("renders a kind-less lifecycle turn as a sentence instead of unknown", async () => {
    const turn = {
      id: "1",
      taskId: "task-1",
      agentCrName: "cr-implement",
      assemblyLineId: "run-1",
      nodeId: "implement",
      iteration: 1,
      eventType: null,
      envelope: {
        source: { task: "task-1" },
        event: { kind: "lifecycle", phase: "init", status: "started" },
      },
      createdAt: "2026-08-12T10:00:00.000Z",
    };

    stubFetch(turnsResponse([turn]));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(await screen.findByText("· init started")).toBeTruthy();
    expect(screen.queryByText("unknown")).toBeNull();
  });

  it("renders a rate-limit turn as one readable line", async () => {
    const turn = {
      id: "1",
      taskId: "task-1",
      agentCrName: "cr-implement",
      assemblyLineId: "run-1",
      nodeId: "implement",
      iteration: 1,
      eventType: "rate_limit_event",
      envelope: {
        source: { task: "task-1" },
        event: {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed_warning",
            rateLimitType: "seven_day",
            utilization: 0.94,
            resetsAt: 1787882400,
          },
        },
      },
      createdAt: "2026-08-12T10:00:00.000Z",
    };

    stubFetch(turnsResponse([turn]));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(await screen.findByText(/rate limit: seven_day 94%/)).toBeTruthy();
  });

  it("shows a timestamp next to each conversation entry", async () => {
    stubFetch(turnsResponse([wireTurn("1", "implement")]));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);
    await screen.findByText(/full text of turn 1/);

    expect(
      document.querySelector('time[datetime="2026-08-12T10:00:00.000Z"]'),
    ).toBeTruthy();
  });
});

describe("FullTranscriptPanel as a terminal conversation", () => {
  function toolTurn(id: string, block: Record<string, unknown>, role: string) {
    return {
      ...wireTurn(id, "implement"),
      eventType: role,
      envelope: {
        source: { task: "task-1" },
        event: { type: role, message: { role, content: [block] } },
      },
    };
  }

  it("folds a tool call and its result into one line the reader can open", async () => {
    stubFetch(
      turnsResponse([
        toolTurn(
          "1",
          {
            type: "tool_use",
            id: "tu-1",
            name: "Read",
            input: { file_path: "src/a.ts" },
          },
          "assistant",
        ),
        toolTurn(
          "2",
          { type: "tool_result", tool_use_id: "tu-1", content: "the contents" },
          "user",
        ),
      ]),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    const call = container.querySelector("details[data-tool-call]");

    expect(call?.querySelector("summary")).toHaveTextContent("Read");
    expect(call?.querySelector("pre")).toHaveTextContent("the contents");
  });

  it("folds a task transition inside the node's window into the conversation as a system line", async () => {
    stubFetch(turnsResponse([wireTurn("1", "implement")]));
    const { container } = render(
      <FullTranscriptPanel
        runId="run-1"
        nodeId="implement"
        rows={[
          {
            nodeId: "implement",
            iteration: 1,
            outcome: null,
            agentCrName: null,
            commitSha: null,
            durationSeconds: null,
            startedAt: "2026-08-12T09:59:00.000Z",
          },
        ]}
        taskEvents={[
          {
            id: "7",
            task_id: "task-1",
            from_status: "running",
            to_status: "pr_created",
            metadata: null,
            created_at: "2026-08-12T10:00:30.000Z",
          },
          {
            id: "6",
            task_id: "task-1",
            from_status: "pending",
            to_status: "running",
            metadata: null,
            created_at: "2026-08-12T09:00:00.000Z",
          },
        ]}
      />,
    );

    await openPanel(container);
    await screen.findByText(/full text of turn 1/);

    const rows = [...container.querySelectorAll("[data-entry]")].map((row) =>
      row.getAttribute("data-entry"),
    );

    expect(rows).toEqual(["segment", "turn", "task-event"]);
    expect(container.querySelector("[data-task-event]")).toHaveTextContent(
      "task Running → PR created",
    );
  });
});
