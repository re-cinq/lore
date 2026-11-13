import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import {
  specTicketsIssuesHandle,
  type SpecTicketsIssuesDeps,
} from "./station.js";

const DECOMPOSITION = JSON.stringify({
  stories: [
    {
      title: "Ship the widget",
      summary: "the team ships the widget",
      acceptance_criteria: ["the widget ships"],
      labels: ["area:web-ui"],
      tasks: [
        {
          id: "T001",
          description: "build the widget",
          title: "Build the widget",
          context: "The spec asks for a widget.",
          plan_quotes: ["We will build a widget."],
          depends_on: [],
          parallelizable: true,
          phase: 1,
          labels: ["area:floor"],
        },
      ],
    },
  ],
});

const LABELS = ["area:web-ui", "area:floor", "lore-managed", "user-story"];

function brief() {
  return {
    visitId: "visit-issues",
    iteration: 1,
    needs: {
      target: "https://github.com/re-cinq/lore@main",
      spec_path: "specs/widget/spec.md",
    },
  };
}

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from(DECOMPOSITION)),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

interface Filed {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
}

function fakeRepository(labels: string[]) {
  const filed: Filed[] = [];
  const updated: number[] = [];

  return {
    filed,
    updated,
    project: {
      repo: {
        read: async (path: string) => {
          if (path === "specs/widget/plan.md") {
            return "This is the approved plan for the widget.";
          }

          return null;
        },
      },
      issues: {
        listLabels: async () => labels,
        list: async () => filed,
        create: async (title: string, body: string, l: string[] = []) => {
          const number = 100 + filed.length;

          filed.push({ number, title, body, labels: l, state: "open" });

          return {
            number,
            url: `https://github.com/re-cinq/lore/issues/${number}`,
          };
        },
        addSubIssue: async () => undefined,
        update: async (number: number, change: { body?: string }) => {
          updated.push(number);
          const issue = filed.find((one) => one.number === number);

          if (issue && change.body) {
            issue.body = change.body;
          }
        },
        comment: async () => undefined,
        listComments: async () => [],
        updateComment: async () => undefined,
        close: async () => undefined,
      },
    } as never,
  };
}

function handleFor(
  project: ReturnType<typeof fakeRepository>["project"],
  overrides: Partial<SpecTicketsIssuesDeps> = {},
) {
  return specTicketsIssuesHandle({
    runOf: () => Promise.resolve("run-1"),
    project: () => Promise.resolve(project),
    ...overrides,
  });
}

describe("spec-tickets file-issues plan payload", () => {
  it("carries the approved plan text in the story issue and quotes in the task issue", async () => {
    const repository = fakeRepository(LABELS);

    const report = await handleFor(repository.project)(brief(), TOOLS);
    const storyIssue = repository.filed.find((i) =>
      i.labels.includes("user-story"),
    );
    const taskIssue = repository.filed.find((i) =>
      i.title.includes("Build the widget"),
    );

    expect({
      outcome: report.outcome,
      hasStoryPlan: storyIssue?.body.includes(
        "<details><summary>The approved plan</summary>",
      ),
      hasStoryPlanText: storyIssue?.body.includes(
        "This is the approved plan for the widget.",
      ),
      hasTaskPlanQuotes: taskIssue?.body.includes("## From the plan"),
      hasTaskPlanText: taskIssue?.body.includes("> We will build a widget."),
    }).toEqual({
      outcome: "success",
      hasStoryPlan: true,
      hasStoryPlanText: true,
      hasTaskPlanQuotes: true,
      hasTaskPlanText: true,
    });
  });
});
