import { describe, it, expect } from "vitest";
import { runIssuesStation } from "./issues.js";
import { storyCoverageOf } from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import {
  storyMarker,
  taskMarker,
} from "@re-cinq/lore-shared/feature-planning/plan-issues.js";

const DECOMPOSITION = JSON.stringify({
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
          title: "Stream node events",
          context: "The run page needs live node updates.",
          depends_on: [],
          parallelizable: true,
          phase: 1,
          labels: ["area:floor"],
        },
        {
          id: "T002",
          description: "render node events on the graph",
          depends_on: ["T001"],
          parallelizable: false,
          phase: 2,
        },
      ],
    },
  ],
});

const LABELS = ["area:web-ui", "area:floor", "lore-managed", "user-story"];

function input(params: Record<string, string> = {}): StationInput {
  return {
    assembly_run_id: "11111111-2222-3333-4444-555555555555",
    node_id: "issues",
    node_type: "issues",
    repo: "re-cinq/lore",
    branch: "spec/x",
    task_id: "task-1",
    params,
  };
}

type ExistingIssue = {
  number: number;
  state: "open" | "closed";
  body: string;
};

function fakeProject(
  labels: string[],
  existing: ExistingIssue[] = [],
  specs: Record<string, string> = {},
) {
  const reads: string[] = [];
  const issues: Array<{ title: string; body: string; labels?: string[] }> = [];
  const steps: string[] = [];
  const bodies = new Map<number, string>();
  const comments: Array<{ id: number; number: number; body: string }> = [];
  let n = 100;

  return {
    issues,
    steps,
    bodies,
    reads,
    comments,
    project: {
      repo: {
        read: async (path: string, ref: string) => {
          reads.push(`${path}@${ref}`);

          return specs[path] ?? null;
        },
      },
      issues: {
        listLabels: async () => labels,
        list: async (filter: { state: string; labels: string[] }) =>
          existing
            .filter((issue) => issue.state === filter.state)
            .map((issue) => ({
              ...issue,
              repo: "re-cinq/lore",
              title: `#${issue.number}`,
              labels: filter.labels,
            })),
        create: async (title: string, body: string, l?: string[]) => {
          issues.push({ title, body, labels: l });
          n += 1;
          bodies.set(n, body);
          steps.push(`issue #${n} ${title}`);

          return { number: n, url: `https://github.com/x/${n}` };
        },
        addSubIssue: async (parent: number, child: number) => {
          steps.push(`sub #${child} under #${parent}`);
        },
        update: async (
          number: number,
          edit: { title?: string; body?: string },
        ) => {
          bodies.set(number, edit.body ?? "");
          steps.push(`update #${number}${edit.title ? ` ${edit.title}` : ""}`);
        },
        comment: async (number: number, body: string) => {
          comments.push({ id: comments.length + 1, number, body });
          steps.push(`comment #${number}`);
        },
        listComments: async (number: number) =>
          comments.filter((comment) => comment.number === number),
        updateComment: async (id: number, body: string) => {
          const found = comments.find((comment) => comment.id === id);

          if (found) {
            found.body = body;
          }
          steps.push(`edit comment ${id}`);
        },
        close: async (number: number, reason?: string) => {
          steps.push(`close #${number} ${reason}`);
        },
      },
    } as never,
  };
}

async function storySpecLinkFor(specPath: string): Promise<string> {
  const fake = fakeProject([
    "area:web-ui",
    "area:floor",
    "lore-managed",
    "user-story",
  ]);

  await runIssuesStation(
    input({ feature_decomposition: DECOMPOSITION, spec_path: specPath }),
    { project: fake.project },
  );

  return fake.bodies.get(101) ?? "";
}

const SPEC = [
  "# Live runs",
  "",
  "Authors watch their runs.",
  "",
  "## Requirements",
  "",
  "- FR1 — The run page streams node events.",
  "- FR2 — The graph renders each node event.",
  "",
].join("\n");

const REVIEW_SPEC = [
  "# Reviews",
  "",
  "Reviewers follow runs.",
  "",
  "## Requirements",
  "",
  "- FR9 — Reviewers see each node event.",
  "",
].join("\n");

const SPEC_PLAN = JSON.stringify({
  creates: [{ path: "specs/live/spec.md" }],
  updates: [{ path: "specs/review/spec.md" }],
});

const CITING_DECOMPOSITION = JSON.stringify({
  ...JSON.parse(DECOMPOSITION),
  spec_commit: "abc123",
  stories: JSON.parse(DECOMPOSITION).stories.map(
    (story: { tasks: object[] }) => ({
      ...story,
      tasks: story.tasks.map((task, index) =>
        index === 0 ? { ...task, spec_lines: [7] } : task,
      ),
    }),
  ),
});

async function filedCitingSpec() {
  const fake = fakeProject(LABELS, [], { "specs/live/spec.md": SPEC });

  await runIssuesStation(
    input({
      feature_decomposition: CITING_DECOMPOSITION,
      spec_path: "specs/live/",
    }),
    { project: fake.project },
  );

  return fake;
}

describe("runIssuesStation citing the spec", () => {
  it("links T001's issue to FR1 on spec line 7 at commit abc123, the one the decomposition read", async () => {
    const fake = await filedCitingSpec();

    expect({
      reads: fake.reads,
      implements: fake.bodies
        .get(102)
        ?.includes(
          "## Implements\n\n- [FR1 — The run page streams node events.](https://github.com/re-cinq/lore/blob/abc123/specs/live/spec.md#L7)\n",
        ),
    }).toEqual({ reads: ["specs/live/spec.md@abc123"], implements: true });
  });

  it("ends the story with 1 of 2 statements covered, listing FR2 on line 8", async () => {
    const story = (await filedCitingSpec()).bodies.get(101) ?? "";

    expect(story).toContain(
      "1 of 2 testable spec statements have a task. Not covered yet:\n\n- line 8: FR2 — The graph renders each node event. — https://github.com/re-cinq/lore/blob/abc123/specs/live/spec.md#L8\n",
    );
  });

  it("links FR1 at the branch spec/x it read the spec at when the decomposition names no commit", async () => {
    const fake = fakeProject(LABELS, [], { "specs/live/spec.md": SPEC });
    const { spec_commit: _none, ...uncommitted } =
      JSON.parse(CITING_DECOMPOSITION);

    await runIssuesStation(
      input({
        feature_decomposition: JSON.stringify(uncommitted),
        spec_path: "specs/live/",
      }),
      { project: fake.project },
    );

    expect({
      reads: fake.reads,
      linksBranch: fake.bodies
        .get(102)
        ?.includes(
          "(https://github.com/re-cinq/lore/blob/spec/x/specs/live/spec.md#L7)",
        ),
    }).toEqual({ reads: ["specs/live/spec.md@spec/x"], linksBranch: true });
  });

  it("links T001's issue to FR9 on line 7 of specs/review/spec.md, the second spec the plan's spec PR wrote, counting 2 of 3 statements across both", async () => {
    const fake = fakeProject(LABELS, [], {
      "specs/live/spec.md": SPEC,
      "specs/review/spec.md": REVIEW_SPEC,
    });
    const decomposition = JSON.parse(CITING_DECOMPOSITION);

    decomposition.stories[0].tasks[0].spec_lines = {
      "specs/live/": [7],
      "specs/review/spec.md": [7],
    };
    await runIssuesStation(
      input({
        feature_decomposition: JSON.stringify(decomposition),
        spec_path: "specs/live/",
        spec_plan: SPEC_PLAN,
      }),
      { project: fake.project },
    );

    expect({
      reads: fake.reads,
      implementsFr9: fake.bodies
        .get(102)
        ?.includes(
          "- [FR9 — Reviewers see each node event.](https://github.com/re-cinq/lore/blob/abc123/specs/review/spec.md#L7)",
        ),
      story: fake.bodies
        .get(101)
        ?.includes("2 of 3 testable spec statements have a task."),
    }).toEqual({
      reads: ["specs/live/spec.md@abc123", "specs/review/spec.md@abc123"],
      implementsFr9: true,
      story: true,
    });
  });

  it("files the issues without a spec section when spec_path names no file on the branch", async () => {
    const fake = fakeProject(LABELS);

    await runIssuesStation(
      input({
        feature_decomposition: CITING_DECOMPOSITION,
        spec_path: "specs/live/",
      }),
      { project: fake.project },
    );

    expect({
      task: fake.bodies.get(102)?.includes("## Implements"),
      story: fake.bodies.get(101)?.includes("## Spec coverage"),
    }).toEqual({ task: false, story: false });
  });
});

describe("runIssuesStation", () => {
  it("files one story issue, then per task its own issue linked under the story, then lists the task issues in the story", async () => {
    const fake = fakeProject(LABELS);

    expect(
      await runIssuesStation(
        input({
          feature_decomposition: DECOMPOSITION,
          plan_title: "Live runs",
        }),
        { project: fake.project },
      ),
    ).toMatchObject({
      outcome: "success",
      extras: {
        "Lore-Story-Issue": "101",
        "Lore-Issues": "3",
      },
    });
    expect(fake.steps).toEqual([
      "issue #101 User story: Live runs",
      "issue #102 T001: Stream node events",
      "sub #102 under #101",
      "issue #103 T002: render node events on the graph",
      "sub #103 under #101",
      "update #101",
    ]);
  });

  it("writes each task issue as part of the story, with its dependencies by issue number", async () => {
    const fake = fakeProject(LABELS);

    await runIssuesStation(input({ feature_decomposition: DECOMPOSITION }), {
      project: fake.project,
    });

    expect({
      t001: fake.bodies.get(102)?.startsWith("Part of #101.\n"),
      t002Deps: fake.bodies.get(103)?.includes("**Depends on:** #102"),
      t001Context: fake.bodies
        .get(102)
        ?.includes("The run page needs live node updates."),
    }).toEqual({ t001: true, t002Deps: true, t001Context: true });
  });

  it("links the story to its plan page and lists the filed task issues as a checklist", async () => {
    const fake = fakeProject(LABELS);

    await runIssuesStation(
      input({
        feature_decomposition: DECOMPOSITION,
        plan_id: "3b3a67af",
        plan_title: "Live runs",
      }),
      { project: fake.project, uiUrl: "https://lore.example" },
    );

    expect({
      plan: fake.bodies
        .get(101)
        ?.startsWith(
          "**Plan:** [Live runs](https://lore.example/repos/re-cinq/lore/plans/3b3a67af)",
        ),
      checklist: fake.bodies
        .get(101)
        ?.includes("- [ ] #102 T001: Stream node events"),
    }).toEqual({ plan: true, checklist: true });
  });

  it("sends the decomposition back when it names a label the repo lacks, filing nothing so a half-filed decomposition can be re-run cleanly", async () => {
    const fake = fakeProject(["area:web-ui", "lore-managed", "user-story"]);
    const result = await runIssuesStation(
      input({ feature_decomposition: DECOMPOSITION }),
      { project: fake.project },
    );

    expect(result.outcome).toBe("changes_requested");
    expect(result.extras?.["Lore-Issues-Objection"]).toContain("area:floor");
    expect(fake.issues).toEqual([]);
  });

  it("fails rather than asking for rework when no artifact reached the node", async () => {
    const fake = fakeProject([]);

    expect(await runIssuesStation(input(), { project: fake.project })).toEqual({
      outcome: "failed",
    });
  });

  it("names the feature checkout from spec path specs/checkout/spec.md, so the story links that spec", async () => {
    expect(await storySpecLinkFor("specs/checkout/spec.md")).toContain(
      "/specs/checkout/",
    );
  });

  it("names the feature checkout from the spec directory specs/checkout/", async () => {
    expect(await storySpecLinkFor("specs/checkout/")).toContain(
      "/specs/checkout/",
    );
  });

  it("marks story #101 and task issue #102 with plan 3b3a67af, so a rerun finds them", async () => {
    const fake = fakeProject(LABELS);

    await runIssuesStation(
      input({ feature_decomposition: DECOMPOSITION, plan_id: "3b3a67af" }),
      { project: fake.project },
    );

    expect({
      story: fake.bodies.get(101)?.includes(storyMarker("3b3a67af")),
      task: fake.bodies.get(102)?.includes(taskMarker("3b3a67af", "T001")),
    }).toEqual({ story: true, task: true });
  });

  it("on a rerun of plan 3b3a67af rewrites story #90 and T001's issue #91, files only T002, and closes T003's issue #92 the new decomposition dropped", async () => {
    const fake = fakeProject(LABELS, [
      { number: 90, state: "open", body: storyMarker("3b3a67af") },
      { number: 91, state: "open", body: taskMarker("3b3a67af", "T001") },
      { number: 92, state: "open", body: taskMarker("3b3a67af", "T003") },
    ]);

    const result = await runIssuesStation(
      input({
        feature_decomposition: DECOMPOSITION,
        plan_id: "3b3a67af",
        plan_title: "Live runs",
      }),
      { project: fake.project },
    );

    expect({ extras: result.extras, steps: fake.steps }).toEqual({
      extras: {
        "Lore-Story-Issue": "90",
        "Lore-Issues": "3",
      },
      steps: [
        "update #91 T001: Stream node events",
        "issue #101 T002: render node events on the graph",
        "sub #101 under #90",
        "comment #92",
        "close #92 not_planned",
        "update #90 User story: Live runs",
      ],
    });
  });

  it("leaves T001's closed issue #91 as it is, while T002 still names it as a dependency", async () => {
    const fake = fakeProject(LABELS, [
      { number: 91, state: "closed", body: taskMarker("3b3a67af", "T001") },
    ]);

    await runIssuesStation(
      input({ feature_decomposition: DECOMPOSITION, plan_id: "3b3a67af" }),
      { project: fake.project },
    );

    expect({
      touched91: fake.steps.filter((step) => step.includes("#91")),
      t002Deps: fake.bodies.get(102)?.includes("**Depends on:** #91"),
    }).toEqual({ touched91: [], t002Deps: true });
  });
});

const LONG_STATEMENT =
  "The agent answers the support ticket in the customer's own words. ".repeat(
    4,
  );
const LONG_SPEC = [
  "# Support agent",
  "",
  "Agents answer support tickets.",
  "",
  "## Requirements",
  "",
  ...Array.from(
    { length: 400 },
    (_, index) => `- FR${index + 1} — ${LONG_STATEMENT}`,
  ),
  "",
].join("\n");

async function filedLongSpec() {
  const fake = fakeProject(LABELS, [], { "specs/live/spec.md": LONG_SPEC });

  await runIssuesStation(
    input({
      feature_decomposition: CITING_DECOMPOSITION,
      spec_path: "specs/live/",
      plan_id: "p1",
    }),
    { project: fake.project },
  );

  return fake;
}

describe("runIssuesStation with a spec too long for one issue body", () => {
  it("files a story body under 65,536 chars and lists the other 399 uncovered statements in its comments", async () => {
    const fake = await filedLongSpec();
    const story = fake.bodies.get(101) ?? "";
    const storyComments = fake.comments
      .filter((comment) => comment.number === 101)
      .map((comment) => comment.body);

    expect({
      fits: story.length <= 65_536,
      listed: storyCoverageOf(story, storyComments, "p1").length,
    }).toEqual({ fits: true, listed: 399 });
  });

  it("empties the 3 filed comments and files none when a rerun lists just FR2 in the body", async () => {
    const fake = await filedLongSpec();
    const story = fake.bodies.get(101) ?? "";
    const rerun = fakeProject(
      LABELS,
      [{ number: 101, state: "open", body: story }],
      { "specs/live/spec.md": SPEC },
    );

    rerun.comments.push(...fake.comments);
    await runIssuesStation(
      input({
        feature_decomposition: CITING_DECOMPOSITION,
        spec_path: "specs/live/",
        plan_id: "p1",
      }),
      { project: rerun.project },
    );

    expect({
      commentWrites: rerun.steps.filter((step) => step.includes("comment")),
      listed: storyCoverageOf(
        rerun.bodies.get(101) ?? "",
        rerun.comments.map((comment) => comment.body),
        "p1",
      ),
    }).toEqual({
      commentWrites: ["edit comment 1", "edit comment 2", "edit comment 3"],
      listed: [
        "- line 8: FR2 — The graph renders each node event. — https://github.com/re-cinq/lore/blob/abc123/specs/live/spec.md#L8",
      ],
    });
  });
});

describe("runIssuesStation rerun with coverage comments", () => {
  it("writes no comment when a rerun finds the 3 coverage comments already right", async () => {
    const fake = await filedLongSpec();
    const rerun = fakeProject(
      LABELS,
      [{ number: 101, state: "open", body: fake.bodies.get(101) ?? "" }],
      { "specs/live/spec.md": LONG_SPEC },
    );

    rerun.comments.push(...fake.comments);
    await runIssuesStation(
      input({
        feature_decomposition: CITING_DECOMPOSITION,
        spec_path: "specs/live/",
        plan_id: "p1",
      }),
      { project: rerun.project },
    );

    expect(rerun.steps.filter((step) => step.includes("comment"))).toEqual([]);
  });
});
