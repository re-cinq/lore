import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { triageFileIssuesHandle } from "./station.js";

const DECOMPOSITION = JSON.stringify({
  stories: [
    {
      title: "Fix the widget crash",
      summary: "the widget stops crashing",
      acceptance_criteria: ["the widget renders"],
      tasks: [
        {
          id: "T001",
          title: "Guard the empty widget",
          description: "guard the empty widget",
          depends_on: [],
          parallelizable: true,
          phase: 1,
          labels: ["priority:high"],
        },
      ],
    },
  ],
});

const BRIEF = {
  visitId: "visit-triage-issues",
  iteration: 1,
  needs: {
    target: "https://github.com/re-cinq/lore@main",
    issue_number: "42",
  },
};

function tools(): Tools {
  return {
    read: () => Promise.resolve(Buffer.from(DECOMPOSITION)),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
}

interface FiledIssue {
  title: string;
  body: string;
  labels?: string[];
}

function fakeProject() {
  const filed: FiledIssue[] = [];

  return {
    filed,
    project: {
      repo: { read: async () => null },
      issues: {
        listLabels: async () => ["lore-managed", "user-story", "priority:high"],
        list: async () => [],
        create: async (title: string, body: string, labels?: string[]) => {
          filed.push({ title, body, labels });

          return { number: 100 + filed.length };
        },
        addSubIssue: async () => undefined,
        update: async () => undefined,
        comment: async () => undefined,
        listComments: async () => [],
        updateComment: async () => undefined,
        close: async () => undefined,
      },
    } as never,
  };
}

describe("triageFileIssuesHandle", () => {
  it("files the task issue with lore-managed and triage: needs-priority, dropping priority:high, so a person queues it", async () => {
    const fake = fakeProject();
    const handle = triageFileIssuesHandle({
      runOf: () => Promise.resolve("run-1"),
      project: () => Promise.resolve(fake.project),
    });

    const result = await handle(BRIEF, tools());

    expect({ result, taskLabels: fake.filed[1]?.labels }).toEqual({
      result: { outcome: "success" },
      taskLabels: ["lore-managed", "triage: needs-priority"],
    });
  });

  it("marks the story with the triaged issue 42, so a rerun rewrites it instead of filing a second set", async () => {
    const fake = fakeProject();
    const handle = triageFileIssuesHandle({
      runOf: () => Promise.resolve("run-1"),
      project: () => Promise.resolve(fake.project),
    });

    await handle(BRIEF, tools());

    expect(fake.filed[0]?.body).toContain("<!-- lore-plan: triage-42 -->");
  });
});
