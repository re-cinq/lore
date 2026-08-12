// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import FullTranscriptPanel from "./FullTranscriptPanel";
import {
  MAX_TURNS_LOADED,
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
});
