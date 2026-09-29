import { describe, it, expect } from "vitest";
import { runIssuesStation } from "./issues.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

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

function fakeProject(labels: string[]) {
  const issues: Array<{ title: string; body: string; labels?: string[] }> = [];
  const tasks: Array<Record<string, unknown>> = [];
  const steps: string[] = [];
  const bodies = new Map<number, string>();
  let n = 100;

  return {
    issues,
    tasks,
    steps,
    bodies,
    project: {
      issues: {
        listLabels: async () => labels,
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
        updateBody: async (number: number, body: string) => {
          bodies.set(number, body);
          steps.push(`body #${number}`);
        },
      },
      tasks: {
        create: async (t: Record<string, unknown>) => {
          tasks.push(t);
          steps.push(`task ${String(t.issueNumber)}`);
        },
      },
    } as never,
  };
}

async function specSlugFiledFor(specPath: string): Promise<unknown> {
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

  return (fake.tasks[0].contextBundle as Record<string, unknown>).spec_slug;
}

describe("runIssuesStation", () => {
  it("files one story issue, then per task its own issue linked under the story and a spec-task on it, then lists the task issues in the story", async () => {
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
        "Lore-Spec-Tasks": "2",
      },
    });
    expect(fake.steps).toEqual([
      "issue #101 User story: Live runs",
      "issue #102 T001: Stream node events",
      "sub #102 under #101",
      "task 102",
      "issue #103 T002: render node events on the graph",
      "sub #103 under #101",
      "task 103",
      "body #101",
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

  it("files each spec-task on its own issue, carrying its story issue", async () => {
    const fake = fakeProject(LABELS);

    await runIssuesStation(input({ feature_decomposition: DECOMPOSITION }), {
      project: fake.project,
    });

    expect(fake.tasks[0]).toMatchObject({
      taskType: "spec-task",
      taskGroupId: "11111111-2222-3333-4444-555555555555",
      issueNumber: 102,
      issueUrl: "https://github.com/x/102",
      contextBundle: { story_issue: 101, task_issue: 102 },
    });
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
    expect(fake.tasks).toEqual([]);
  });

  it("fails rather than asking for rework when no artifact reached the node", async () => {
    const fake = fakeProject([]);

    expect(await runIssuesStation(input(), { project: fake.project })).toEqual({
      outcome: "failed",
    });
  });

  it("stamps the plan and the spec a spec-task belongs to, so merge-check can flip that spec's status once its group merges", async () => {
    const fake = fakeProject([
      "area:web-ui",
      "area:floor",
      "lore-managed",
      "user-story",
    ]);

    await runIssuesStation(
      input({
        feature_decomposition: DECOMPOSITION,
        plan_id: "1cc0d9de-2b7f-4a35-9d1f-8f6f0a2f4e21",
        spec_path: "specs/checkout/spec.md",
      }),
      { project: fake.project },
    );

    expect(fake.tasks[0]).toMatchObject({
      contextBundle: {
        plan_id: "1cc0d9de-2b7f-4a35-9d1f-8f6f0a2f4e21",
        spec_path: "specs/checkout/spec.md",
      },
    });
  });

  it("stamps spec_slug checkout from spec path specs/checkout/spec.md, the key the dependency check pairs spec-tasks on", async () => {
    expect(await specSlugFiledFor("specs/checkout/spec.md")).toBe("checkout");
  });

  it("stamps spec_slug checkout from the spec directory specs/checkout/", async () => {
    expect(await specSlugFiledFor("specs/checkout/")).toBe("checkout");
  });

  it("names the spec-task id spec_task_id, the way every other consumer reads it, not the agent artifact's own `id` (spreading the raw task left these rows with a blank id)", async () => {
    const fake = fakeProject([
      "area:web-ui",
      "area:floor",
      "lore-managed",
      "user-story",
    ]);

    await runIssuesStation(input({ feature_decomposition: DECOMPOSITION }), {
      project: fake.project,
    });

    expect(fake.tasks[0]).toMatchObject({
      contextBundle: { spec_task_id: "T001", phase: 1 },
    });
  });

  it("omits the plan id when the line carries none", async () => {
    const fake = fakeProject([
      "area:web-ui",
      "area:floor",
      "lore-managed",
      "user-story",
    ]);

    await runIssuesStation(input({ feature_decomposition: DECOMPOSITION }), {
      project: fake.project,
    });

    expect(
      (fake.tasks[0].contextBundle as Record<string, unknown>).plan_id,
    ).toBeUndefined();
  });
});
