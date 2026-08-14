// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getChunks = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/chunks", () => ({ getChunks }));

const { fetchRepoChunks } = await import("./context-data");
const { CONTEXT_PAGE_SIZE } = await import("./pagination");

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRepoChunks", () => {
  it("asks lore-api for the repo's page at the given offset", async () => {
    getChunks.mockResolvedValue({ status: "ok", data: { chunks: [] } });

    await fetchRepoChunks("re-cinq/lore", "spec", "cache", 100);

    expect(getChunks).toHaveBeenCalledWith({
      repo: "re-cinq/lore",
      type: "spec",
      q: "cache",
      limit: CONTEXT_PAGE_SIZE,
      offset: 100,
    });
  });

  it("reports a further page and trims the extra row it was sent", async () => {
    getChunks.mockResolvedValue({
      status: "ok",
      data: { chunks: rows(CONTEXT_PAGE_SIZE + 1) },
    });

    const page = await fetchRepoChunks("re-cinq/lore", undefined, undefined, 0);

    expect(page.hasMore).toBe(true);
    expect(page.chunks).toHaveLength(CONTEXT_PAGE_SIZE);
  });

  it("reports no further page for a partial page", async () => {
    getChunks.mockResolvedValue({ status: "ok", data: { chunks: rows(3) } });

    expect(
      await fetchRepoChunks("re-cinq/lore", undefined, undefined, 0),
    ).toMatchObject({ hasMore: false });
  });

  it("renders an empty page rather than throwing when the read fails", async () => {
    getChunks.mockResolvedValue({ status: "error", message: "down" });

    expect(
      await fetchRepoChunks("re-cinq/lore", undefined, undefined, 0),
    ).toEqual({ chunks: [], hasMore: false });
  });
});
