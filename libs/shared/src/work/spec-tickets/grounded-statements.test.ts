import { describe, it, expect } from "vitest";
import type { DecompositionResult } from "../../domain/feature-planning/decomposition-result.js";
import type { SpecFile } from "../../domain/feature-planning/issue-coverage.js";
import {
  withoutDrift,
  withoutDriftIn,
  withoutUngroundedStatements,
} from "./grounded-statements.js";

const TREE = ["apps/lore-api/src/work/plans/floor-plan-line.ts"];

const SPEC: SpecFile = {
  file: "specs/7-feature-planning/spec.md",
  parts: [
    {
      line: 10,
      text: "The brief is built by `apps/lore-api/src/work/plans/floor-plan-line.ts`.",
    },
    {
      line: 20,
      text: "The archive is served by `apps/floor/src/archive-route.ts`.",
    },
    {
      line: 30,
      text: "The nodeLaunchSpec in `apps/floor/src/worker.ts` forwards every option.",
    },
  ],
};

function decompositionCiting(
  ...tasks: { id: string; lines: number[] }[]
): DecompositionResult {
  return {
    stories: [
      {
        id: "S1",
        title: "Planning",
        tasks: tasks.map(({ id, lines }) => ({
          id,
          title: id,
          spec_lines: lines.map((line) => ({ line })),
        })),
      },
    ],
  } as unknown as DecompositionResult;
}

const taskIds = (decomposition: DecompositionResult) =>
  decomposition.stories.flatMap((story) => story.tasks.map((task) => task.id));

describe("withoutUngroundedStatements", () => {
  it("keeps T1, whose statement names a file on the tree, and reports no drift", () => {
    const { decomposition, drift } = withoutUngroundedStatements(
      decompositionCiting({ id: "T1", lines: [10] }),
      [{ ...SPEC, parts: SPEC.parts.slice(0, 1) }],
      TREE,
    );

    expect({ tasks: taskIds(decomposition), drift }).toEqual({
      tasks: ["T1"],
      drift: [],
    });
  });

  it("files no ticket for T2, whose only statement names the deleted apps/floor, and reports lines 20 and 30 as drift", () => {
    const { decomposition, drift } = withoutUngroundedStatements(
      decompositionCiting({ id: "T1", lines: [10] }, { id: "T2", lines: [20] }),
      [SPEC],
      TREE,
    );

    expect({ tasks: taskIds(decomposition), drift }).toEqual({
      tasks: ["T1"],
      drift: [
        {
          file: "specs/7-feature-planning/spec.md",
          line: 20,
          names: ["apps/floor"],
        },
        {
          file: "specs/7-feature-planning/spec.md",
          line: 30,
          names: ["apps/floor"],
        },
      ],
    });
  });

  it("keeps T3, which cites one grounded and one ungrounded statement, since it still has work here", () => {
    const { decomposition } = withoutUngroundedStatements(
      decompositionCiting({ id: "T3", lines: [10, 30] }),
      [SPEC],
      TREE,
    );

    expect(taskIds(decomposition)).toEqual(["T3"]);
  });

  it("drops a story whose every task names only code that is not in this repository", () => {
    const { decomposition } = withoutUngroundedStatements(
      decompositionCiting({ id: "T2", lines: [20] }, { id: "T4", lines: [30] }),
      [SPEC],
      TREE,
    );

    expect(decomposition.stories).toEqual([]);
  });

  it("keeps a statement that says it adds the file it names", () => {
    const adding: SpecFile = {
      file: "specs/x/spec.md",
      parts: [
        {
          line: 5,
          text: "This change adds `apps/lore-api/src/work/upgrade-check/upgrade-check.ts`.",
        },
      ],
    };
    const { decomposition, drift } = withoutUngroundedStatements(
      decompositionCiting({ id: "T5", lines: [5] }),
      [adding],
      TREE,
    );

    expect({ tasks: taskIds(decomposition), drift }).toEqual({
      tasks: ["T5"],
      drift: [],
    });
  });

  it("reports a statement naming the deleted apps/lore-api/src/gone.ts as drift and files no ticket for it", () => {
    const deleted: SpecFile = {
      file: "specs/x/spec.md",
      parts: [
        { line: 7, text: "The check lives in `apps/lore-api/src/gone.ts`." },
      ],
    };
    const { decomposition, drift } = withoutUngroundedStatements(
      decompositionCiting({ id: "T6", lines: [7] }),
      [deleted],
      TREE,
    );

    expect({ stories: decomposition.stories, drift }).toEqual({
      stories: [],
      drift: [
        {
          file: "specs/x/spec.md",
          line: 7,
          names: ["apps/lore-api/src/gone.ts"],
        },
      ],
    });
  });

  it("reports a statement naming the retired Event Router as drift though every path it names is on the tree", () => {
    const retired: SpecFile = {
      file: "specs/x/spec.md",
      parts: [
        {
          line: 12,
          text: "The Event Router forwards webhooks to `apps/lore-api/src/work/plans/floor-plan-line.ts`.",
        },
      ],
    };
    const { decomposition, drift } = withoutUngroundedStatements(
      decompositionCiting({ id: "T7", lines: [12] }),
      [retired],
      TREE,
    );

    expect({ stories: decomposition.stories, drift }).toEqual({
      stories: [],
      drift: [{ file: "specs/x/spec.md", line: 12, names: ["Event Router"] }],
    });
  });

  it("leaves coverage only lines 10 of the spec once lines 20 and 30 are drift", () => {
    const { drift } = withoutUngroundedStatements(
      decompositionCiting(),
      [SPEC],
      TREE,
    );

    expect(withoutDrift([SPEC], drift)).toEqual([
      { file: SPEC.file, parts: [SPEC.parts[0]] },
    ]);
  });
});

describe("withoutDriftIn", () => {
  it("logs lines 20 and 30 as drift, keeps only line 10 in the spec and files only T1", () => {
    const logged: string[] = [];

    const { spec, decomposition } = withoutDriftIn(
      { specs: [SPEC] },
      decompositionCiting({ id: "T1", lines: [10] }, { id: "T2", lines: [20] }),
      TREE,
      (line) => logged.push(line),
    );

    expect({
      logged,
      lines: spec.specs.flatMap((file) => file.parts.map(({ line }) => line)),
      tasks: taskIds(decomposition),
    }).toEqual({
      logged: [
        "spec-tickets drift: specs/7-feature-planning/spec.md:20 names apps/floor, which this repository does not hold; no ticket filed",
        "spec-tickets drift: specs/7-feature-planning/spec.md:30 names apps/floor, which this repository does not hold; no ticket filed",
      ],
      lines: [10],
      tasks: ["T1"],
    });
  });
});
