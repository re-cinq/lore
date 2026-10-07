import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { fileIssuesHandle, type FileIssuesDeps } from "./station.js";

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
          context: "The plan asks for a widget.",
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

function brief(needs: Partial<Record<string, string>> = {}) {
  return {
    visitId: "visit-issues",
    iteration: 1,
    needs: {
      target: "https://github.com/re-cinq/lore@spec/widget",
      plan_id: "3b3a67af",
      ...needs,
    },
  };
}

function tools(content: Partial<Record<string, string>> = {}): Tools {
  const files: Record<string, string> = {
    decomposition: DECOMPOSITION,
    ...content,
  };

  return {
    read: (need) => Promise.resolve(Buffer.from(files[need] ?? "")),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
}

function fakeProject(labels: string[]) {
  const issues: Array<{ title: string; body: string; labels?: string[] }> = [];
  let n = 100;

  return {
    issues,
    project: {
      repo: { read: async () => null },
      issues: {
        listLabels: async () => labels,
        list: async () => [],
        create: async (title: string, body: string, l?: string[]) => {
          issues.push({ title, body, labels: l });
          n += 1;

          return {
            number: n,
            url: `https://github.com/re-cinq/lore/issues/${n}`,
          };
        },
        addSubIssue: async () => undefined,
        update: async () => undefined,
        comment: async () => undefined,
        close: async () => undefined,
      },
    } as never,
  };
}

function scene(project: ReturnType<typeof fakeProject>["project"]) {
  const deps: FileIssuesDeps = {
    runOf: () => Promise.resolve("run-1"),
    project: (repo) =>
      repo === "re-cinq/lore"
        ? Promise.resolve(project)
        : Promise.reject(new Error(`Not Found: ${repo}`)),
    uiUrl: undefined,
  };

  return fileIssuesHandle(deps);
}

describe("fileIssuesHandle", () => {
  it("parses repo and branch from target, and links the spec_path specs/widget/spec.md the bag carries from the story it files", async () => {
    const fake = fakeProject(LABELS);
    const handle = scene(fake.project);

    const result = await handle(
      brief({ spec_path: "specs/widget/spec.md" }),
      tools(),
    );

    expect(result).toEqual({ outcome: "success" });
    expect(fake.issues[0].body).toContain("/specs/widget/");
  });

  it("reports changes_requested with the objection in error, when a task names a label the repo lacks", async () => {
    const fake = fakeProject(["area:web-ui", "lore-managed", "user-story"]);
    const handle = scene(fake.project);

    const result = await handle(brief(), tools());

    expect(result.outcome).toBe("changes_requested");
    expect(result.error).toContain("area:floor");
    expect(fake.issues).toEqual([]);
  });

  it("files nothing and reports failed when the floor names no run for the visit, since the station input names the run it files for", async () => {
    const fake = fakeProject(LABELS);
    const handle = fileIssuesHandle({
      runOf: () => Promise.resolve(null),
      project: () => Promise.resolve(fake.project),
      uiUrl: undefined,
    });

    const result = await handle(brief(), tools());

    expect({ outcome: result.outcome, issues: fake.issues }).toEqual({
      outcome: "failed",
      issues: [],
    });
  });

  it("reports failed with the error message when the project throws", async () => {
    const handle = fileIssuesHandle({
      runOf: () => Promise.resolve("run-1"),
      project: () => Promise.reject(new Error("github unreachable")),
      uiUrl: undefined,
    });

    expect(await handle(brief(), tools())).toEqual({
      outcome: "failed",
      error: "github unreachable",
    });
  });
  it("links specs/legacy/spec.md derived from the spec_plan of a run started before open-spec-pr produced spec_path", async () => {
    const fake = fakeProject(LABELS);
    const handle = scene(fake.project);

    const result = await handle(
      brief({ spec_plan: "file://spec-plan.json" }),
      tools({
        spec_plan: JSON.stringify({
          creates: [{ path: "specs/legacy/spec.md" }],
        }),
      }),
    );

    expect(result).toEqual({ outcome: "success" });
    expect(fake.issues[0].body).toContain("/specs/legacy/");
  });

  it("folds the approved plan the bag carries as plan_md into the story issue it files", async () => {
    const fake = fakeProject(LABELS);
    const handle = scene(fake.project);

    await handle(
      brief({ plan_md: "sha256:plan" }),
      tools({ plan_md: "# Widget\n\nThe team ships a widget." }),
    );

    expect(fake.issues[0].body).toContain(
      "<details><summary>The approved plan</summary>\n\n# Widget\n\nThe team ships a widget.\n\n</details>",
    );
  });
});
