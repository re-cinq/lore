// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import DefinitionOfDonePanel from "./DefinitionOfDonePanel";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubProgress(...bodies: unknown[]) {
  const fetchMock = vi.fn();

  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );
  }
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("DefinitionOfDonePanel", () => {
  it("reads the run's progress through the proxy on mount and renders the card", async () => {
    const fetchMock = stubProgress({
      present: true,
      acceptanceTests: [],
      passed: 0,
      total: 3,
      report: null,
    });

    render(<DefinitionOfDonePanel runId="run-1" refreshKey="running" />);
    await settle();

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/assembly-runs/run-1/dod",
    );
    expect(
      screen.getByText("0 of 3 acceptance tests pass"),
    ).toBeInTheDocument();
  });

  it("re-reads when the refresh key changes, so a CI check webhook updates the count", async () => {
    const fetchMock = stubProgress(
      { present: true, acceptanceTests: [], passed: 0, total: 3, report: null },
      { present: true, acceptanceTests: [], passed: 3, total: 3, report: null },
    );
    const { rerender } = render(
      <DefinitionOfDonePanel runId="run-1" refreshKey="a" />,
    );

    await settle();
    rerender(<DefinitionOfDonePanel runId="run-1" refreshKey="b" />);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("3 of 3 acceptance tests pass"),
    ).toBeInTheDocument();
  });

  it("renders nothing while the read is pending or after it failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    const { container } = render(
      <DefinitionOfDonePanel runId="run-1" refreshKey="a" />,
    );

    await settle();

    expect(container).toBeEmptyDOMElement();
  });
});
