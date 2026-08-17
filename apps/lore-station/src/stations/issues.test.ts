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
          depends_on: [],
          parallelizable: true,
          phase: 1,
          labels: ["area:floor"],
        },
      ],
    },
  ],
});

function input(params: Record<string, string> = {}): StationInput {
  return {
    assembly_line_id: "11111111-2222-3333-4444-555555555555",
    node_id: "issues",
    node_type: "issues",
    repo: "re-cinq/lore",
    branch: "spec/x",
    task_id: "task-1",
    params,
  };
}

/** A recording stand-in for the pod's HTTP facade — real objects, no mock library. */
function fakeProject(labels: string[]) {
  const issues: Array<{ title: string; body: string; labels?: string[] }> = [];
  const tasks: Array<Record<string, unknown>> = [];
  let n = 100;

  return {
    issues,
    tasks,
    project: {
      issues: {
        listLabels: async () => labels,
        create: async (title: string, body: string, l?: string[]) => {
          issues.push({ title, body, labels: l });

          return { number: ++n, url: `https://github.com/x/${n}` };
        },
      },
      tasks: {
        create: async (t: Record<string, unknown>) => {
          tasks.push(t);
        },
      },
    } as never,
  };
}

describe("runIssuesStation", () => {
  it("files one issue per story and one spec-task per task", async () => {
    const fake = fakeProject([
      "area:web-ui",
      "area:floor",
      "lore-managed",
      "user-story",
    ]);

    expect(
      await runIssuesStation(input({ feature_decomposition: DECOMPOSITION }), {
        project: fake.project,
      }),
    ).toMatchObject({
      outcome: "success",
      extras: { "Lore-Issues": "1", "Lore-Spec-Tasks": "1" },
    });
    expect(fake.issues[0]).toMatchObject({
      title: "User story: Watch a run live",
      labels: ["area:web-ui", "lore-managed", "user-story"],
    });
  });

  it("puts the acceptance criteria in the issue body as a checklist", async () => {
    const fake = fakeProject([
      "area:web-ui",
      "area:floor",
      "lore-managed",
      "user-story",
    ]);

    await runIssuesStation(input({ feature_decomposition: DECOMPOSITION }), {
      project: fake.project,
    });

    expect(fake.issues[0].body).toContain(
      "- [ ] the graph updates without a reload",
    );
  });

  it("links each spec-task to the story issue it implements", async () => {
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
      taskType: "spec-task",
      taskGroupId: "11111111-2222-3333-4444-555555555555",
      contextBundle: { story_issue: 101 },
    });
  });

  it("sends the decomposition back when it names a label the repo lacks", async () => {
    // Nothing is filed: GitHub would have created `area:floor` on the spot, and a
    // half-filed decomposition cannot be re-run cleanly.
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
    // A missing artifact is a WIRING failure — the agent did nothing wrong, so
    // re-running it would fix nothing.
    const fake = fakeProject([]);

    expect(await runIssuesStation(input(), { project: fake.project })).toEqual({
      outcome: "failed",
    });
  });

  it("stamps the feature a spec-task belongs to", async () => {
    // The join key the whole decomposition view hangs on. Without it the UI's
    // `context_bundle->>'feature_id'` filter matched zero rows — always — so a
    // decomposed feature rendered an empty task tree, and merge-check's
    // spec-status flip never fired either.
    const fake = fakeProject([
      "area:web-ui",
      "area:floor",
      "lore-managed",
      "user-story",
    ]);

    await runIssuesStation(
      input({
        feature_decomposition: DECOMPOSITION,
        feature_id: "1cc0d9de-2b7f-4a35-9d1f-8f6f0a2f4e21",
      }),
      { project: fake.project },
    );

    expect(fake.tasks[0]).toMatchObject({
      contextBundle: { feature_id: "1cc0d9de-2b7f-4a35-9d1f-8f6f0a2f4e21" },
    });
  });

  it("names the spec-task id the way every other consumer reads it", async () => {
    // The agent's artifact calls it `id`; every reader of a spec-task's
    // context_bundle — the tasks.md sync, lore_list_pipeline_tasks, the decomposition
    // view — calls it `spec_task_id`. Spreading the raw task made these rows the only
    // ones that disagreed, so they rendered with a blank id.
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

  it("omits the feature id when the line carries none", async () => {
    // A decomposition can be driven without a feature row behind it; the tasks are
    // still valid work, they just have nothing to link back to.
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
      (fake.tasks[0].contextBundle as Record<string, unknown>).feature_id,
    ).toBeUndefined();
  });
});
