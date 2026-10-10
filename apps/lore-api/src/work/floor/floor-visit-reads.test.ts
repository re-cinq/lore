import { describe, expect, it } from "vitest";
import { FLOOR_RUN, FLOOR_VISIT } from "./floor-run.fixtures.js";
import { visitEvents, type VisitReadDeps } from "./floor-visit-reads.js";

function endlessEvents(): { deps: VisitReadDeps; pagesRead: () => number } {
  let pages = 0;
  const deps: VisitReadDeps = {
    visitById: async () => FLOOR_VISIT,
    runById: async () => FLOOR_RUN,
    recordsOf: async () => [],
    lineFactsOf: async () => ({
      graph: {
        name: "code-review",
        entry: "review",
        exit: "done",
        nodes: [],
        edges: [],
      },
      routes: {},
      startEvents: {},
    }),
    eventsPage: async () => {
      pages += 1;

      return { items: [], nextCursor: String(pages) };
    },
  };

  return { deps, pagesRead: () => pages };
}

describe("visitEvents", () => {
  it("stops after 25 pages of a run whose events never end", async () => {
    const { deps, pagesRead } = endlessEvents();

    await visitEvents(deps, FLOOR_RUN.id, FLOOR_VISIT.id);

    expect(pagesRead()).toBe(25);
  });
});
