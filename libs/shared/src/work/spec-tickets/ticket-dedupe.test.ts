import { describe, expect, it } from "vitest";
import type {
  DecompTask,
  DecompositionResult,
} from "../../domain/feature-planning/decomposition-result.js";
import {
  dedupeDecomposition,
  dedupeReport,
  DUPLICATE_SCORE,
  RELATED_SCORE,
  ticketQuery,
  type TicketMatch,
  type TicketSearchOutcome,
} from "./ticket-dedupe.js";

function task(id: string, title: string): DecompTask {
  return {
    id,
    title,
    description: `Build ${title.toLowerCase()}.`,
    depends_on: [],
    parallelizable: false,
    phase: 0,
  };
}

function decompositionOf(...stories: DecompTask[][]): DecompositionResult {
  return {
    spec_commit: "c1",
    stories: stories.map((tasks, index) => ({
      title: `Story ${index + 1}`,
      summary: "",
      acceptance_criteria: [],
      tasks,
    })),
  };
}

function match(
  number: number,
  score: number,
  state: TicketMatch["state"] = "open",
): TicketMatch {
  return { number, title: `Ticket ${number}`, state, score };
}

const NO_OWN = { ids: new Set<string>(), numbers: new Set<number>() };

function dedupe(
  decomposition: DecompositionResult,
  searches: Record<string, TicketSearchOutcome>,
  own = NO_OWN,
) {
  return dedupeDecomposition(
    decomposition,
    new Map(Object.entries(searches)),
    own,
  );
}

describe("dedupeDecomposition", () => {
  it("drops T001 as duplicate_of #7 when open #7 scores at the duplicate threshold", () => {
    const result = dedupe(
      decompositionOf([task("T001", "Add login"), task("T002", "Add logout")]),
      {
        T001: { tickets: [match(7, DUPLICATE_SCORE)] },
        T002: { tickets: [] },
      },
    );

    expect({
      kept: result.decomposition.stories[0]?.tasks.map((t) => t.id),
      report: result.report,
    }).toEqual({
      kept: ["T002"],
      report: [{ taskId: "T001", verdict: "duplicate_of", ticket: 7 }],
    });
  });

  it("drops T001 as done_in #9 when closed #9 scores above the duplicate threshold", () => {
    const result = dedupe(
      decompositionOf([task("T001", "Add login"), task("T002", "Add logout")]),
      { T001: { tickets: [match(9, DUPLICATE_SCORE + 0.1, "closed")] } },
    );

    expect(result.report).toEqual([
      { taskId: "T001", verdict: "done_in", ticket: 9 },
    ]);
  });

  it("keeps T001 with Related: #4 appended when #4 scores between the related and duplicate thresholds", () => {
    const result = dedupe(decompositionOf([task("T001", "Add login")]), {
      T001: { tickets: [match(4, RELATED_SCORE)] },
    });

    expect(result).toEqual({
      decomposition: decompositionOf([
        {
          ...task("T001", "Add login"),
          description: "Build add login.\n\nRelated: #4",
        },
      ]),
      report: [{ taskId: "T001", verdict: "related", ticket: 4 }],
    });
  });

  it("keeps T001 unchanged when its best match scores below the related threshold", () => {
    const decomposition = decompositionOf([task("T001", "Add login")]);

    expect(
      dedupe(decomposition, {
        T001: { tickets: [match(4, RELATED_SCORE - 0.01)] },
      }),
    ).toEqual({ decomposition, report: [] });
  });

  it("keeps T001 whose id an earlier run filed as #5, though #5 matches it exactly", () => {
    const decomposition = decompositionOf([task("T001", "Add login")]);
    const own = { ids: new Set(["T001"]), numbers: new Set([5]) };

    expect(
      dedupe(decomposition, { T001: { tickets: [match(5, 1)] } }, own),
    ).toEqual({ decomposition, report: [] });
  });

  it("drops T002 as duplicate_of #8 past this spec's own #5 that scores higher", () => {
    const own = { ids: new Set<string>(), numbers: new Set([5]) };
    const result = dedupe(
      decompositionOf([task("T001", "Add login"), task("T002", "Add logout")]),
      { T002: { tickets: [match(5, 1), match(8, DUPLICATE_SCORE)] } },
      own,
    );

    expect(result.report).toEqual([
      { taskId: "T002", verdict: "duplicate_of", ticket: 8 },
    ]);
  });

  it("drops story 2 whose one task is a duplicate, keeping story 1", () => {
    const result = dedupe(
      decompositionOf(
        [task("T001", "Add login")],
        [task("T002", "Add logout")],
      ),
      { T002: { tickets: [match(8, 1)] } },
    );

    expect(result.decomposition.stories.map((s) => s.title)).toEqual([
      "Story 1",
    ]);
  });

  it("keeps T001 and reports search_failed when its search failed", () => {
    const decomposition = decompositionOf([task("T001", "Add login")]);

    expect(
      dedupe(decomposition, { T001: { error: "GET /tickets/search failed" } }),
    ).toEqual({
      decomposition,
      report: [
        {
          taskId: "T001",
          verdict: "search_failed",
          reason: "GET /tickets/search failed",
        },
      ],
    });
  });

  it("keeps T001 and reports search_failed with the note when the search answers notes", () => {
    const decomposition = decompositionOf([task("T001", "Add login")]);
    const note = "search_tickets: acme/widget has no Utopia base";

    expect(
      dedupe(decomposition, {
        T001: { tickets: [match(3, 1)], notes: [note] },
      }),
    ).toEqual({
      decomposition,
      report: [{ taskId: "T001", verdict: "search_failed", reason: note }],
    });
  });
});

describe("ticketQuery", () => {
  it("joins title and description cut at 200 characters", () => {
    const long = { ...task("T001", "Add login"), description: "x".repeat(300) };

    expect(ticketQuery(long)).toBe(`Add login\n${"x".repeat(200)}`);
  });
});

describe("dedupeReport", () => {
  it("prints one line per verdict under a heading", () => {
    expect(
      dedupeReport([
        { taskId: "T001", verdict: "duplicate_of", ticket: 7 },
        { taskId: "T002", verdict: "search_failed", reason: "no base" },
      ]),
    ).toBe(
      "## Ticket dedupe\n\n- T001: duplicate_of #7\n- T002: kept, search failed: no base",
    );
  });

  it("says nothing matched when there are no verdicts", () => {
    expect(dedupeReport([])).toBe(
      "## Ticket dedupe\n\nNo new task matched an existing ticket.",
    );
  });
});
