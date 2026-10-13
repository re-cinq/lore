import { describe, it, expect } from "vitest";
import { storyIssueBody, taskIssueBody } from "./issue-bodies.js";
import { storyMarker, withMarker } from "./plan-issues.js";
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

  it("ends with the spec coverage it is given", () => {
    const coverage =
      "## Spec coverage\n\n2 of 3 testable spec statements have a task.\n";
    const body = storyIssueBody({ repo: REPO, stories: STORIES, coverage });

    expect(body.endsWith(`\n${coverage}`)).toBe(true);
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

  it("carries the approved plan folded under the plan line, so the story reads without opening the plan page", () => {
    const body = storyIssueBody({
      repo: REPO,
      planTitle: "Issue triage Assembly Line",
      planMarkdown: "# Issue triage\n\nReproduction runs before any diagnosis.",
      stories: STORIES,
    });

    expect(body.split("\n").slice(0, 9)).toEqual([
      "**Plan:** Issue triage Assembly Line",
      "",
      "<details><summary>The approved plan</summary>",
      "",
      "# Issue triage",
      "",
      "Reproduction runs before any diagnosis.",
      "",
      "</details>",
    ]);
  });

  it("cuts a plan of 70,000 characters short with a pointer to the plan page, keeping the story body under GitHub's 65,536", () => {
    const body = storyIssueBody({
      repo: REPO,
      planTitle: "Issue triage Assembly Line",
      planUrl: "https://lore.example/repos/re-cinq/lore/plans/3b3a67af",
      planMarkdown: "x".repeat(70_000),
      stories: STORIES,
    });

    expect({
      underLimit: body.length < 65_536,
      pointer: body.includes(
        "*The plan continues on [its page](https://lore.example/repos/re-cinq/lore/plans/3b3a67af).*",
      ),
      keepsStories: body.endsWith("- T006: Add the human-gate node\n"),
    }).toEqual({ underLimit: true, pointer: true, keepsStories: true });
  });

  it("keeps the story under GitHub's 65,536 once the plan marker is appended to a cut plan of 70,000 characters", () => {
    const planId = "64e50ec3-2dfb-457a-ae4f-fd3859a7c227";
    const body = withMarker(
      storyIssueBody({
        repo: REPO,
        planMarkdown: "x".repeat(70_000),
        stories: STORIES,
      }),
      storyMarker(planId),
    );

    expect(body.length).toBeLessThanOrEqual(65_536);
  });

  it("leaves the plan out when the stories alone leave no room for it under GitHub's 65,536", () => {
    const body = storyIssueBody({
      repo: REPO,
      planTitle: "Issue triage Assembly Line",
      planMarkdown: "# Issue triage",
      stories: [{ ...STORIES[0], summary: "x".repeat(65_200) }],
    });

    expect({
      underLimit: body.length <= 65_536,
      plan: body.includes("<details>"),
    }).toEqual({ underLimit: true, plan: false });
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

  it("quotes each spec statement it implements as a link to its line, cutting a long one at 80 characters", () => {
    const link = "https://github.com/re-cinq/lore/blob/abc123/specs/f/spec.md";
    const long =
      "FR2 — The issues station links every task issue to the spec statements it implements, by line.";
    const body = taskIssueBody({
      repo: REPO,
      storyNumber: 2260,
      dependsOn: [],
      specStatements: [
        { text: "FR1 — The station files [one] issue.", link: `${link}#L7` },
        { text: long, link: `${link}#L8` },
      ],
      task: {
        id: "T001",
        description: "File the issues",
        depends_on: [],
        parallelizable: false,
        phase: 1,
      },
    });

    expect(body.split("\n").slice(0, 6)).toEqual([
      "Part of #2260.",
      "",
      "## Implements",
      "",
      `- [FR1 — The station files \\[one\\] issue.](${link}#L7)`,
      `- [${long.slice(0, 79)}…](${link}#L8)`,
    ]);
  });

  it("names dependency T007 by its task id when its issue is filed after this one", () => {
    const body = taskIssueBody({
      repo: REPO,
      storyNumber: 2260,
      dependsOn: [2261, "T007"],
      task: {
        id: "T003",
        description: "reproduce",
        depends_on: ["T001", "T007"],
        parallelizable: false,
        phase: 3,
      },
    });

    expect(body).toContain("**Depends on:** #2261, T007\n");
  });

  it("links a spec section named as written to GitHub's anchor for that heading, so the link opens the section", () => {
    const body = taskIssueBody({
      repo: REPO,
      storyNumber: 2257,
      dependsOn: [],
      task: {
        id: "T005",
        description: "verify",
        depends_on: [],
        parallelizable: false,
        phase: 3,
        references: [
          "specs/issue-triage/spec.md#User Story 2 - Root Cause Diagnosis and Spec Verification (Priority: P1)",
        ],
      },
    });

    expect(body).toContain(
      "- [specs/issue-triage/spec.md#User Story 2 - Root Cause Diagnosis and Spec Verification (Priority: P1)](https://github.com/re-cinq/lore/blob/HEAD/specs/issue-triage/spec.md#user-story-2---root-cause-diagnosis-and-spec-verification-priority-p1)",
    );
  });

  it("keeps a heading that itself holds a # whole, linking Support for C# repos to #support-for-c-repos", () => {
    const body = taskIssueBody({
      repo: REPO,
      storyNumber: 2257,
      dependsOn: [],
      task: {
        id: "T005",
        description: "verify",
        depends_on: [],
        parallelizable: false,
        phase: 3,
        references: ["specs/issue-triage/spec.md#Support for C# repos"],
      },
    });

    expect(body).toContain(
      "(https://github.com/re-cinq/lore/blob/HEAD/specs/issue-triage/spec.md#support-for-c-repos)",
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

  it("quotes the plan passages the task comes from, after its context", () => {
    const body = taskIssueBody({
      repo: REPO,
      dependsOn: [],
      task: {
        id: "T003",
        description: "reproduce",
        depends_on: [],
        parallelizable: false,
        phase: 3,
        context: "The first station of the line.",
        plan_quotes: ["Reproduction runs before any diagnosis."],
      },
    });

    expect(body).toContain(
      [
        "## Context",
        "",
        "The first station of the line.",
        "",
        "## From the plan",
        "",
        "> Reproduction runs before any diagnosis.",
        "",
        "## What to change",
      ].join("\n"),
    );
  });

  it("cuts a task body with 100,000 chars of context to 65,000, ending on a note", () => {
    const body = taskIssueBody({
      repo: REPO,
      dependsOn: [],
      task: {
        id: "T001",
        description: "File the issues",
        context: "x".repeat(100_000),
        depends_on: [],
        parallelizable: false,
        phase: 1,
      },
    });

    expect({ length: body.length, end: body.slice(-47) }).toEqual({
      length: 65_000,
      end: "\n\n*Cut short: GitHub holds 65,536 characters.*\n",
    });
  });
});
