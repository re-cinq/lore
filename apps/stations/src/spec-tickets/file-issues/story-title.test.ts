import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { storyMarker } from "@re-cinq/lore-shared/feature-planning/plan-issues.js";
import { specTicketsIssuesHandle } from "./station.js";

const WIDGET_PATH = "specs/widget/spec.md";
const GADGET_PATH = "specs/gadget/spec.md";
const SETUP = "Setup and foundation";
const SPEC_WITH_STATEMENTS =
  "# Widget\nA list.\n## Requirements\n\n- The widget MUST render messages.\n- The widget MUST accept a colour.\n";
const EVERY_STATEMENT_PRESENT = JSON.stringify({
  spec_commit: "merge123",
  statements: [5, 6].map((line) => ({
    file: WIDGET_PATH,
    line,
    status: "present",
    evidence: [{ path: "src/widget.ts", start: 1, end: 1, text: "Widget" }],
  })),
  stories: [{ title: SETUP, tasks: [{ ...baseTask(), spec_lines: [5, 6] }] }],
});

interface Filed {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
}

interface Run {
  firstSlice?: string;
  specPath?: string;
  commit?: string | null;
  verified?: boolean;
  decomposition?: string;
}

describe("the story issue of a spec on the spec-tickets line", () => {
  it("titles it User story: Widget after the spec's heading, not its first slice Setup and foundation", async () => {
    expect(
      await storyTitleOf({ [`${WIDGET_PATH}@merge123`]: "# Widget\n\nText." }),
    ).toBe("User story: Widget");
  });

  it("titles it after the heading on a run with no verified decomposition", async () => {
    expect(
      await storyTitleOf(
        { [`${WIDGET_PATH}@merge123`]: "# Widget\n" },
        { verified: false },
      ),
    ).toBe("User story: Widget");
  });

  it("reads the heading at the decomposition's spec_commit rather than the branch", async () => {
    expect(
      await storyTitleOf({
        [`${WIDGET_PATH}@merge123`]: "# Widget\n",
        [`${WIDGET_PATH}@main`]: "# Renamed since\n",
      }),
    ).toBe("User story: Widget");
  });

  it("reads the heading on the branch when the decomposition names no commit", async () => {
    expect(
      await storyTitleOf(
        { [`${WIDGET_PATH}@main`]: "# Widget\n" },
        { commit: null },
      ),
    ).toBe("User story: Widget");
  });

  it("drops a leading Feature Specification from the heading", async () => {
    expect(
      await storyTitleOf({
        [`${WIDGET_PATH}@merge123`]: "# Feature Specification: Widget\n",
      }),
    ).toBe("User story: Widget");
  });

  it("titles it by the path specs/widget/spec.md when the spec has no heading", async () => {
    expect(
      await storyTitleOf({ [`${WIDGET_PATH}@merge123`]: "No heading here.\n" }),
    ).toBe(`User story: ${WIDGET_PATH}`);
  });

  it("titles it by the path specs/widget/spec.md when the spec cannot be read", async () => {
    expect(await storyTitleOf({})).toBe(`User story: ${WIDGET_PATH}`);
  });

  it("names the spec on the story's plan line rather than the first slice", async () => {
    const { filed, project } = repository({
      [`${WIDGET_PATH}@merge123`]: "# Widget\n",
    });

    await file(project);

    expect(filed[0].body).toContain("**Plan:** Widget");
  });

  it("keeps the title when a later merge calls the first slice something else", async () => {
    const files = { [`${WIDGET_PATH}@merge123`]: "# Widget\n" };
    const { filed, project } = repository(files);

    await file(project, { firstSlice: "Runner Review Mode" });
    await file(project, { firstSlice: SETUP });

    expect({ issues: filed.length, title: filed[0].title }).toEqual({
      issues: 2,
      title: "User story: Widget",
    });
  });

  it("renames a story an earlier run titled User story: Setup and foundation", async () => {
    const { filed, project } = repository(
      { [`${WIDGET_PATH}@merge123`]: "# Widget\n" },
      [earlierStory()],
    );

    await file(project);

    expect(filed[0]).toMatchObject({
      number: 12,
      title: "User story: Widget",
    });
  });

  it("titles it after the heading when nothing remains to ticket and its story is completed", async () => {
    const { filed, project } = repository(
      { [`${WIDGET_PATH}@merge123`]: SPEC_WITH_STATEMENTS },
      [earlierStory()],
    );

    await file(project, { decomposition: EVERY_STATEMENT_PRESENT });

    expect(filed).toEqual([
      expect.objectContaining({ number: 12, title: "User story: Widget" }),
    ]);
  });

  it("gives two specs whose first slices are both Setup and foundation different titles", async () => {
    const files = {
      [`${WIDGET_PATH}@merge123`]: "# Widget\n",
      [`${GADGET_PATH}@merge123`]: "# Gadget\n",
    };

    expect([
      await storyTitleOf(files, { specPath: WIDGET_PATH }),
      await storyTitleOf(files, { specPath: GADGET_PATH }),
    ]).toEqual(["User story: Widget", "User story: Gadget"]);
  });
});

function earlierStory(): Filed {
  return {
    number: 12,
    title: `User story: ${SETUP}`,
    body: storyMarker("spec-widget"),
    labels: [],
    state: "open",
  };
}

async function storyTitleOf(files: Record<string, string>, run: Run = {}) {
  const { filed, project } = repository(files);

  await file(project, run);

  return filed[0]?.title;
}

function repository(files: Record<string, string>, filed: Filed[] = []) {
  const update = async (number: number, change: Partial<Filed>) => {
    Object.assign(filed.find((one) => one.number === number) ?? {}, change);
  };
  const create = async (title: string, body: string, labels: string[] = []) => {
    const number = 100 + filed.length;

    filed.push({ number, title, body, labels, state: "open" });

    return { number, url: `https://github.com/re-cinq/lore/issues/${number}` };
  };

  return {
    filed,
    project: {
      repo: {
        read: async (path: string, ref: string) =>
          files[`${path}@${ref}`] ?? null,
      },
      issues: {
        listLabels: async () => [],
        list: async () => filed,
        listComments: async () => [],
        addSubIssue: async () => undefined,
        comment: async () => undefined,
        updateComment: async () => undefined,
        close: async () => undefined,
        create,
        update,
      },
    } as never,
  };
}

async function file(project: never, run: Run = {}) {
  const { specPath = WIDGET_PATH, verified = true } = run;

  return specTicketsIssuesHandle({
    runOf: async () => "run-1",
    project: async () => project,
    savePlanStory: async () => undefined,
  })(
    {
      visitId: "visit-issues",
      iteration: 1,
      needs: {
        target: "https://github.com/re-cinq/lore@main",
        spec_path: specPath,
        ...(verified ? { verified_decomposition: "verified" } : {}),
      },
    },
    toolsFor(run),
  );
}

function toolsFor(run: Run): Tools {
  return {
    read: async () => Buffer.from(run.decomposition ?? oneSlice(run)),
    produce: async () => undefined,
    modelCall: async () => undefined,
    signal: new AbortController().signal,
  };
}

function oneSlice({ firstSlice = SETUP, commit = "merge123" }: Run) {
  return JSON.stringify({
    ...(commit === null ? {} : { spec_commit: commit }),
    stories: [{ title: firstSlice, tasks: [baseTask()] }],
  });
}

function baseTask() {
  return {
    id: "T001",
    description: "Build the widget",
    depends_on: [],
    parallelizable: false,
    phase: 0,
  };
}
