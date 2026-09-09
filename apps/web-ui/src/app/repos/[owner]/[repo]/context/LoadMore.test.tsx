// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoadMore from "./LoadMore";

const page = (overrides: { chunks?: unknown[]; hasMore?: boolean } = {}) => ({
  chunks: overrides.chunks ?? [
    {
      id: "x",
      file_path: "docs/next.md",
      content_type: "doc",
      content: "Appended body",
      ingested_at: "2026-06-03T10:00:00Z",
      metadata: null,
    },
  ],
  hasMore: overrides.hasMore ?? false,
});

describe("LoadMore", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the next page and appends a linked card", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => page(),
    });
    render(<LoadMore owner="o" repo="r" initialOffset={50} hasMore />);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "docs/next.md" }),
      ).toBeInTheDocument(),
    );
    const link = screen.getByRole("link", { name: "docs/next.md" });

    expect(link).toHaveAttribute("href", "/repos/o/r/context/docs%2Fnext.md");
    expect(fetch).toHaveBeenCalledWith(
      "/api/repos/o/r/context?offset=50",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("forwards the active query and type to the API", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => page(),
    });
    render(
      <LoadMore
        owner="o"
        repo="r"
        q="hello world"
        type="doc"
        initialOffset={50}
        hasMore
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/repos/o/r/context?offset=50&q=hello+world&type=doc",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("hides the button once the API reports no more pages", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => page({ hasMore: false }),
    });
    render(<LoadMore owner="o" repo="r" initialOffset={50} hasMore />);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /load more/i })).toBeNull(),
    );
  });

  it("keeps paging from an advancing offset", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => page({ hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => page({ hasMore: false }),
      });
    render(<LoadMore owner="o" repo="r" initialOffset={50} hasMore />);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(
      await screen.findByRole("button", { name: /load more/i }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/repos/o/r/context?offset=50",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/repos/o/r/context?offset=100",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});
