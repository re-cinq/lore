import { describe, it, expect } from "vitest";
import { decideIssueWork } from "./issue-work.js";
import type { DecompositionResult } from "./decomposition-result.js";

const REPO_LABELS = [
  "lore-managed",
  "user-story",
  "area:floor",
  "area:web-ui",
  "tech-debt",
];

const decomposition = (
  over: Partial<DecompositionResult> = {},
): DecompositionResult => ({
  stories: [
    {
      title: "Watch a run live",
      summary: "the author sees nodes advance",
      acceptance_criteria: ["the graph updates without a reload"],
      labels: ["area:web-ui"],
      tasks: [
        {
          id: "T001",
          description: "stream node events over SSE",
          depends_on: [],
          parallelizable: true,
          phase: 1,
          file_path: "apps/floor/src/delivery/http/routes/agent-events.ts",
          labels: ["area:floor"],
        },
      ],
    },
  ],
  ...over,
});

describe("decideIssueWork", () => {
  it("files one issue per story, always carrying lore-managed", () => {
    const work = decideIssueWork(decomposition(), REPO_LABELS);

    expect(work).toMatchObject({ outcome: "proceed" });
    expect(work.outcome === "proceed" && work.issues).toMatchObject([
      {
        title: "User story: Watch a run live",
        labels: ["area:web-ui", "lore-managed", "user-story"],
      },
    ]);
  });

  it("carries every task through as a spec-task", () => {
    const work = decideIssueWork(decomposition(), REPO_LABELS);

    expect(work.outcome === "proceed" && work.tasks).toMatchObject([
      { description: "stream node events over SSE", storyIndex: 0 },
    ]);
  });

  it("requests changes naming a label the repo does not have, since GitHub silently creates unknown labels instead of failing loudly", () => {
    const work = decideIssueWork(
      decomposition({
        stories: [{ ...decomposition().stories[0], labels: ["area:frontend"] }],
      }),
      REPO_LABELS,
    );

    expect(work).toEqual({
      outcome: "changes_requested",
      objection:
        'these labels do not exist in this repository: "area:frontend". Use only labels the repo already has.',
    });
  });

  it("names every unknown label at once, so one correction fixes them all", () => {
    const work = decideIssueWork(
      decomposition({
        stories: [
          {
            ...decomposition().stories[0],
            labels: ["area:frontend"],
            tasks: [
              {
                ...decomposition().stories[0].tasks[0],
                labels: ["area:backend"],
              },
            ],
          },
        ],
      }),
      REPO_LABELS,
    );

    expect(work.outcome === "changes_requested" && work.objection).toContain(
      '"area:backend", "area:frontend"',
    );
  });

  it("requests changes for a decomposition with no stories", () => {
    const work = decideIssueWork({ stories: [] }, REPO_LABELS);

    expect(work).toMatchObject({
      outcome: "changes_requested",
      objection: "the decomposition contains no user stories",
    });
  });

  it("requests changes for a story that breaks into no tasks, since nobody can start it", () => {
    const work = decideIssueWork(
      decomposition({
        stories: [{ ...decomposition().stories[0], tasks: [] }],
      }),
      REPO_LABELS,
    );

    expect(work.outcome === "changes_requested" && work.objection).toContain(
      "Watch a run live",
    );
  });

  it("proceeds with no labels at all rather than blocking the work, since lore-managed is the floor for a repo with no taxonomy", () => {
    const work = decideIssueWork(
      decomposition({
        stories: [
          {
            ...decomposition().stories[0],
            labels: undefined,
            tasks: [
              { ...decomposition().stories[0].tasks[0], labels: undefined },
            ],
          },
        ],
      }),
      [],
    );

    expect(work.outcome === "proceed" && work.issues[0].labels).toEqual([
      "lore-managed",
      "user-story",
    ]);
  });
});
