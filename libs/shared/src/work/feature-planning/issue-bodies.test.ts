import { describe, it, expect } from "vitest";
import { storyIssueBody, taskIssueBody } from "./issue-bodies.js";
import type { UserStory } from "../../domain/feature-planning/decomposition-result.js";

const REPO = "re-cinq/lore";
const SPEC = "https://github.com/re-cinq/lore/blob/HEAD/specs/issue-triage";

const STORIES: UserStory[] = [
  {
    title: "Automated bug reproduction",
    summary: "An issue labelled for triage is reproduced in a sandbox.",
    acceptance_criteria: ["a reproduced issue carries triage: reproduced"],
    tasks: [
      {
        id: "T001",
        title: "Add the issue-triage line stub",
        description: "stub",
        depends_on: [],
        parallelizable: false,
        phase: 1,
      },
      {
        id: "T003",
        title: "Define the reproduce node",
        description: "reproduce",
        depends_on: ["T001"],
        parallelizable: false,
        phase: 3,
      },
    ],
  },
  {
    title: "Human-gated handoff",
    summary: "A maintainer hands a diagnosed issue to implementation.",
    acceptance_criteria: [],
    tasks: [
      {
        id: "T006",
        description: "Add the human-gate node",
        depends_on: [],
        parallelizable: false,
        phase: 5,
      },
    ],
  },
];

describe("storyIssueBody", () => {
  it("links the plan page and the spec's three files, then one section per slice with its acceptance criteria and task titles", () => {
    expect(
      storyIssueBody({
        repo: REPO,
        planTitle: "Issue triage Assembly Line",
        planUrl: "https://lore.example/repos/re-cinq/lore/plans/3b3a67af",
        specSlug: "issue-triage",
        stories: STORIES,
      }),
    ).toBe(
      [
        "**Plan:** [Issue triage Assembly Line](https://lore.example/repos/re-cinq/lore/plans/3b3a67af)",
        `**Spec:** [spec.md](${SPEC}/spec.md) · [plan.md](${SPEC}/plan.md) · [tasks.md](${SPEC}/tasks.md)`,
        "",
        "Each task below is its own sub-issue of this story.",
        "",
        "## Automated bug reproduction",
        "",
        "An issue labelled for triage is reproduced in a sandbox.",
        "",
        "**Acceptance criteria**",
        "",
        "- [ ] a reproduced issue carries triage: reproduced",
        "",
        "**Tasks**",
        "",
        "- T001: Add the issue-triage line stub",
        "- T003: Define the reproduce node",
        "",
        "## Human-gated handoff",
        "",
        "A maintainer hands a diagnosed issue to implementation.",
        "",
        "**Tasks**",
        "",
        "- T006: Add the human-gate node",
        "",
      ].join("\n"),
    );
  });

  it("lists each task by its filed issue once the numbers are known, as a checklist GitHub keeps current", () => {
    const body = storyIssueBody({
      repo: REPO,
      planTitle: "Issue triage Assembly Line",
      stories: STORIES,
      taskIssues: new Map([
        ["T001", 2261],
        ["T003", 2263],
        ["T006", 2266],
      ]),
    });

    expect(body).toContain(
      "- [ ] #2261 T001: Add the issue-triage line stub\n- [ ] #2263 T003: Define the reproduce node\n",
    );
  });

  it("names the plan without a link when no web UI address is known, and leaves out spec links without a spec", () => {
    const body = storyIssueBody({
      repo: REPO,
      planTitle: "Issue triage Assembly Line",
      stories: STORIES,
    });

    expect(body.split("\n").slice(0, 2)).toEqual([
      "**Plan:** Issue triage Assembly Line",
      "",
    ]);
  });
});

describe("taskIssueBody", () => {
  it("gives a developer everything to implement the task: its story, context, changes, acceptance criteria, test plan, references and dependencies", () => {
    expect(
      taskIssueBody({
        repo: REPO,
        storyNumber: 2260,
        dependsOn: [2261],
        task: {
          id: "T003",
          title: "Define the reproduce node",
          description: "reproduce",
          depends_on: ["T001"],
          parallelizable: false,
          phase: 3,
          file_path: "libs/assembly-lines/src/assembly-lines/issue-triage.yaml",
          context: "The first station of the line.",
          changes: "Add a `reproduce` agent node to issue-triage.yaml.",
          acceptance_criteria: ["the loader accepts the node"],
          test_plan: "Run the assembly-lines loader tests.",
          references: [
            "specs/issue-triage/plan.md#assembly-line-graph",
            "ADR-031",
          ],
        },
      }),
    ).toBe(
      [
        "Part of #2260.",
        "",
        "**Depends on:** #2261",
        "",
        "## Context",
        "",
        "The first station of the line.",
        "",
        "## What to change",
        "",
        "Add a `reproduce` agent node to issue-triage.yaml.",
        "",
        "Target file: `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] the loader accepts the node",
        "",
        "## How to test",
        "",
        "Run the assembly-lines loader tests.",
        "",
        "## References",
        "",
        "- [specs/issue-triage/plan.md#assembly-line-graph](https://github.com/re-cinq/lore/blob/HEAD/specs/issue-triage/plan.md#assembly-line-graph)",
        "- ADR-031",
        "",
      ].join("\n"),
    );
  });

  it("falls back to the task's description when decompose wrote no detail", () => {
    expect(
      taskIssueBody({
        repo: REPO,
        storyNumber: 2260,
        dependsOn: [],
        task: {
          id: "T006",
          description: "Add the human-gate node",
          depends_on: [],
          parallelizable: false,
          phase: 5,
        },
      }),
    ).toBe(
      [
        "Part of #2260.",
        "",
        "## What to change",
        "",
        "Add the human-gate node",
        "",
      ].join("\n"),
    );
  });
});
