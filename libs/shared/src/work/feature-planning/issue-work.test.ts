import { describe, it, expect } from "vitest";
import { decideIssueWork } from "./issue-work.js";
import type { DecompositionResult } from "../../domain/feature-planning/decomposition-result.js";

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
          file_path: "apps/floor/src/transport/http/routes/agent-events.ts",
          labels: ["area:floor"],
        },
      ],
    },
  ],
  ...over,
});

describe("decideIssueWork", () => {
  it("files ONE story issue for the whole plan, titled after it and carrying every slice's labels", () => {
    const [slice] = decomposition().stories;
    const work = decideIssueWork(
      decomposition({
        stories: [
          slice,
          { ...slice, title: "Replay a run", labels: ["tech-debt"] },
        ],
      }),
      REPO_LABELS,
      "Live run view",
    );

    expect(work.outcome === "proceed" && work.story).toEqual({
      title: "User story: Live run view",
      labels: ["area:web-ui", "tech-debt", "lore-managed", "user-story"],
    });
  });

  it("titles the story after its first slice when the line carries no plan title", () => {
    const work = decideIssueWork(decomposition(), REPO_LABELS);

    expect(work.outcome === "proceed" && work.story.title).toBe(
      "User story: Watch a run live",
    );
  });

  it("files every task as its own issue, titled by its id and title and labelled spec-task", () => {
    const [slice] = decomposition().stories;
    const work = decideIssueWork(
      decomposition({
        stories: [
          {
            ...slice,
            tasks: [{ ...slice.tasks[0], title: "Stream node events" }],
          },
        ],
      }),
      REPO_LABELS,
    );

    expect(work.outcome === "proceed" && work.tasks).toMatchObject([
      {
        title: "T001: Stream node events",
        description: "stream node events over SSE",
        labels: ["area:floor", "lore-managed", "spec-task"],
        storyIndex: 0,
      },
    ]);
  });

  it("titles a task with no title of its own by its description", () => {
    const work = decideIssueWork(decomposition(), REPO_LABELS);

    expect(work.outcome === "proceed" && work.tasks[0].title).toBe(
      "T001: stream node events over SSE",
    );
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

    expect(
      work.outcome === "proceed" && {
        story: work.story.labels,
        task: work.tasks[0].labels,
      },
    ).toEqual({
      story: ["lore-managed", "user-story"],
      task: ["lore-managed", "spec-task"],
    });
  });
});
