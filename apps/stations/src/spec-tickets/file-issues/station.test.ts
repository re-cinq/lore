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
      repo: { read: async () => null },
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

describe("specTicketsIssuesHandle", () => {
  it("files a story and its task for the spec, both marked with the spec's filing key and linking the spec", async () => {
    const repository = fakeRepository(LABELS);

    const report = await handleFor(repository.project)(brief(), TOOLS);

    expect({
      report,
      markers: repository.filed.map(
        (issue) => issue.body.match(/<!-- (lore-plan[^ ]*: [^ ]+) -->/)?.[1],
      ),
      linksSpec: repository.filed[0].body.includes("/specs/widget/"),
    }).toEqual({
      report: { outcome: "success" },
      markers: ["lore-plan: spec-widget", "lore-plan-task: spec-widget/T001"],
      linksSpec: true,
    });
  });

  it("rewrites the issues of an earlier run of the same spec and files no second set", async () => {
    const repository = fakeRepository(LABELS);
    const handle = handleFor(repository.project);

    await handle(brief(), TOOLS);
    await handle(brief(), TOOLS);

    expect({
      filed: repository.filed.length,
      rewritten: [...new Set(repository.updated)].sort(),
    }).toEqual({ filed: 2, rewritten: [100, 101] });
  });

  it("reports changes_requested with the objection in error, when a task names a label the repo lacks", async () => {
    const repository = fakeRepository([
      "area:web-ui",
      "lore-managed",
      "user-story",
    ]);

    const report = await handleFor(repository.project)(brief(), TOOLS);

    expect({
      outcome: report.outcome,
      error: report.error?.includes("area:floor"),
      filed: repository.filed,
    }).toEqual({ outcome: "changes_requested", error: true, filed: [] });
  });

  it("files nothing and reports failed when the floor names no run for the visit", async () => {
    const repository = fakeRepository(LABELS);

    const report = await handleFor(repository.project, {
      runOf: () => Promise.resolve(null),
    })(brief(), TOOLS);

    expect({ outcome: report.outcome, filed: repository.filed }).toEqual({
      outcome: "failed",
      filed: [],
    });
  });

  it("reports failed with the error message when the project throws", async () => {
    const handle = specTicketsIssuesHandle({
      runOf: () => Promise.resolve("run-1"),
      project: () => Promise.reject(new Error("github unreachable")),
    });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: "github unreachable",
    });
  });
});
