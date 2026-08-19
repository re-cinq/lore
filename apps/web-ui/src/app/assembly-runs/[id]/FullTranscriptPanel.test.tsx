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
    envelope: { event: { type: "assistant", text: `full text of turn ${id}` } },
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

function toggle(container: HTMLElement, open: boolean) {
  const details = container.querySelector("details");

  if (!details) {
    throw new Error("panel not rendered");
  }
  details.open = open;
  fireEvent(details, new Event("toggle"));
}

async function openPanel(container: HTMLElement) {
  toggle(container, true);

  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("FullTranscriptPanel", () => {
  it("renders collapsed and fetches nothing until opened", () => {
    const fetchMock = stubFetch();

    render(<FullTranscriptPanel runId="run-1" nodeId="implement" />);

    expect(screen.getByText("Full transcript")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the run's turns once opened and renders the untruncated envelope", async () => {
    stubFetch(turnsResponse([wireTurn("1", "implement")]));
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(await screen.findByText(/full text of turn 1/)).toBeTruthy();
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
  });

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

    expect(await screen.findByText("iteration 2")).toBeTruthy();
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
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>(() => {
          // Deliberately never resolves — the walk stays in flight.
        }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);
    toggle(container, false);
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
    const fetchMock = stubFetch(
      new Response("{}", { status: 500 }),
      turnsResponse([wireTurn("1", "implement")]),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);
    expect(await screen.findByText(/Failed to load turns/)).toBeTruthy();

    toggle(container, false);
    await openPanel(container);

    expect(await screen.findByText(/full text of turn 1/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

    toggle(container, false);
    await openPanel(container);

    expect(screen.queryByText(/Failed to load turns/)).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});

// Opt-in hasMore variant: the shared turnsResponse deliberately omits the flag
// so every pre-#1310 test keeps exercising the short-page fallback.
function turnsPageResponse(turns: unknown[], hasMore: boolean) {
  return new Response(JSON.stringify({ turns, hasMore }), { status: 200 });
}

// A drifted walk crosses up to MAX_WALK_PAGES pages; openPanel's 12 hops
// flush only a few.
async function openPanelLong(container: HTMLElement) {
  toggle(container, true);

  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("FullTranscriptPanel with the Floor's hasMore flag", () => {
  it("keeps walking across a short page while the Floor reports more", async () => {
    // A drifted Floor clamp: pages far below TURNS_PAGE_LIMIT that still
    // report more rows must continue the walk instead of silently truncating.
    const fetchMock = stubFetch(
      turnsPageResponse(
        [wireTurn("1", "implement"), wireTurn("2", "implement")],
        true,
      ),
      turnsPageResponse([wireTurn("3", "implement")], false),
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
      turnsPageResponse(fullPage(1, "implement"), false),
    );
    const { container } = render(
      <FullTranscriptPanel runId="run-1" nodeId="implement" />,
    );

    await openPanel(container);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops paging when the Floor reports more but the page carries no usable cursor, and says so", async () => {
    const fetchMock = stubFetch(
      turnsPageResponse([{ id: 7 }, {}] as unknown[], true),
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
      turnsPageResponse([wireTurn(String(i + 1), "implement")], true),
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
});
