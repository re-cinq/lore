// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getRepoEvents = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/activity", () => ({ getRepoEvents }));

const { fetchRepoEvents } = await import("./events-data");
const { EVENTS_PAGE_SIZE } = await import("./pagination");

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: String(i) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRepoEvents", () => {
  it("asks for one row past the page size from the given offset", async () => {
    getRepoEvents.mockResolvedValue({ status: "ok", data: { events: [] } });

    await fetchRepoEvents("re-cinq/lore", 200);

    expect(getRepoEvents).toHaveBeenCalledWith(
      "re-cinq/lore",
      EVENTS_PAGE_SIZE + 1,
      200,
    );
  });

  it("reports a further page and trims the extra row off the page it returns", async () => {
    getRepoEvents.mockResolvedValue({
      status: "ok",
      data: { events: rows(EVENTS_PAGE_SIZE + 1) },
    });

    const page = await fetchRepoEvents("re-cinq/lore", 0);

    expect(page.hasMore).toBe(true);
    expect(page.events).toHaveLength(EVENTS_PAGE_SIZE);
  });

  it("reports no further page for a partial page", async () => {
    getRepoEvents.mockResolvedValue({
      status: "ok",
      data: { events: rows(3) },
    });

    expect(await fetchRepoEvents("re-cinq/lore", 0)).toMatchObject({
      hasMore: false,
    });
  });

  it("renders an empty page rather than throwing when the read fails", async () => {
    getRepoEvents.mockResolvedValue({ status: "error", message: "down" });

    expect(await fetchRepoEvents("re-cinq/lore", 0)).toEqual({
      events: [],
      hasMore: false,
    });
  });
});
