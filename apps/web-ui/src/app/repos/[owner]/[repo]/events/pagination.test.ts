import { describe, it, expect } from "vitest";
import { EVENTS_PAGE_SIZE, repoEventsQuery } from "./pagination";

describe("repoEventsQuery", () => {
  it("filters by the repo column and orders by captured_at descending", () => {
    const { sql } = repoEventsQuery("re-cinq/lore", 0);

    expect(sql).toContain("WHERE repo = $1");
    expect(sql).toContain("ORDER BY captured_at DESC");
  });

  it("requests one row past the page size from the given offset", () => {
    expect(repoEventsQuery("re-cinq/lore", 200).params).toEqual([
      "re-cinq/lore",
      EVENTS_PAGE_SIZE + 1,
      200,
    ]);
  });
});
