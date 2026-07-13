import { describe, it, expect } from "vitest";
import { groupDecomposition, type DecompTaskRow } from "./decomposition-view";

const row = (
  over: Partial<DecompTaskRow> & { context_bundle?: Record<string, unknown> },
): DecompTaskRow => ({
  description: "T001: do it",
  status: "pending",
  context_bundle: {
    spec_task_id: "T001",
    story_issue: 7,
    phase: 1,
    ...over.context_bundle,
  },
  ...over,
});

describe("groupDecomposition", () => {
  it("groups tasks under their story issue and counts the total", () => {
    const rows = [
      row({
        description: "T001: a",
        context_bundle: { spec_task_id: "T001", story_issue: 7, phase: 1 },
      }),
      row({
        description: "T002: b",
        status: "completed",
        context_bundle: { spec_task_id: "T002", story_issue: 7, phase: 2 },
      }),
    ];
    const grouped = groupDecomposition(rows);
    expect(grouped.total).toBe(2);
    expect(grouped.stories).toEqual([
      {
        storyIssue: 7,
        tasks: [
          {
            specTaskId: "T001",
            description: "T001: a",
            status: "pending",
            phase: 1,
          },
          {
            specTaskId: "T002",
            description: "T002: b",
            status: "completed",
            phase: 2,
          },
        ],
      },
    ]);
  });

  it("separates tasks belonging to different stories, ordered by issue number", () => {
    const rows = [
      row({ context_bundle: { spec_task_id: "T002", story_issue: 9 } }),
      row({ context_bundle: { spec_task_id: "T001", story_issue: 8 } }),
    ];
    expect(groupDecomposition(rows).stories.map((s) => s.storyIssue)).toEqual([
      8, 9,
    ]);
  });

  it("puts tasks with no story issue into a single null group, ordered last", () => {
    const rows = [
      row({ context_bundle: { spec_task_id: "T002" } }), // no story_issue
      row({ context_bundle: { spec_task_id: "T001", story_issue: 5 } }),
    ];
    expect(groupDecomposition(rows).stories.map((s) => s.storyIssue)).toEqual([
      5,
      null,
    ]);
  });

  it("returns an empty result for no rows", () => {
    expect(groupDecomposition([])).toEqual({ stories: [], total: 0 });
  });
});
