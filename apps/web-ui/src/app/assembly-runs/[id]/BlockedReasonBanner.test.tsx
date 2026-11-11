// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import BlockedReasonBanner from "./BlockedReasonBanner";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("BlockedReasonBanner", () => {
  it("fetches the blocked reason and displays the label for a finished run with a PR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | Request | URL) => {
        if (
          url
            .toString()
            .includes("/api/repos/re-cinq/lore/pulls/42/blocked-reason")
        ) {
          return {
            ok: true,
            json: async () => ({ label: "Waiting for CI" }),
          };
        }

        return { ok: false, json: async () => null };
      }),
    );

    render(
      <BlockedReasonBanner
        repo="re-cinq/lore"
        prNumber={42}
        runStatus="finished"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/repos/re-cinq/lore/pulls/42/blocked-reason",
        ),
        expect.anything(),
      );
    });

    expect(screen.getByText("Waiting for CI")).toBeInTheDocument();
  });

  it("renders nothing and does not fetch while the run is still running or has no PR", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const { container, rerender } = render(
      <BlockedReasonBanner
        repo="re-cinq/lore"
        prNumber={42}
        runStatus="running"
      />,
    );

    await settle();
    rerender(
      <BlockedReasonBanner
        repo="re-cinq/lore"
        prNumber={null}
        runStatus="finished"
      />,
    );
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the blocked reason label is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ label: null }),
      }),
    );

    const { container } = render(
      <BlockedReasonBanner
        repo="re-cinq/lore"
        prNumber={42}
        runStatus="finished"
      />,
    );

    await settle();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the unavailable notice when the blocked-reason read fails or rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockRejectedValueOnce(new Error("network down"));

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <BlockedReasonBanner
        repo="re-cinq/lore"
        prNumber={42}
        runStatus="finished"
        refreshKey="a"
      />,
    );

    await settle();
    expect(screen.getByText("Blocked reason unavailable.")).toBeInTheDocument();

    rerender(
      <BlockedReasonBanner
        repo="re-cinq/lore"
        prNumber={42}
        runStatus="finished"
        refreshKey="b"
      />,
    );
    await settle();
    expect(screen.getByText("Blocked reason unavailable.")).toBeInTheDocument();
  });

  it("refreshes the blocked reason while the settled run remains open", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ label: "Waiting for CI" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ label: "Needs 1 approval" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <BlockedReasonBanner
        repo="re-cinq/lore"
        prNumber={42}
        runStatus="finished"
      />,
    );

    await settle();
    expect(screen.getByText("Waiting for CI")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Needs 1 approval")).toBeInTheDocument();
  });
});
