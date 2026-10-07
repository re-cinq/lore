import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { CoverageDeps, RunVisit } from "../coverage-deps.js";
import { issueCoverageHandle } from "./station.js";

const SPEC_PATH = "specs/live/spec.md";
const SPEC = [
  "# Live runs",
  "",
  "Authors watch their runs.",
  "",
  "## Requirements",
  "",
  "- FR1 — The run page streams node events. ([from plan](https://lore.example/plans/p1#b-1))",
  "- FR2 — The graph renders each node event.",
  "",
].join("\n");

function decomposition(...specLines: number[][]): string {
  return JSON.stringify({
    spec_commit: "abc123",
    stories: [
      {
        title: "Watch a run live",
        tasks: specLines.map((lines, index) => ({
          id: `T00${index + 1}`,
          description: "d",
          spec_lines: lines,
        })),
      },
    ],
  });
}

const HANDLER_PATH = "libs/shared/src/work/backlog/label-dispatch.ts";
const HANDLER =
  "const working = await deps.activeTaskByIssue(repo, issue.number);";

function decompositionWith(task: Record<string, unknown>): string {
  return JSON.stringify({
    spec_commit: "abc123",
    stories: [
      {
        title: "Hand off",
        tasks: [{ id: "T006", description: "d", spec_lines: [7, 8], ...task }],
      },
    ],
  });
}

const NEEDS = {
  target: "https://github.com/re-cinq/lore@main",
  decomposition: "blob://decomposition",
  spec_path: SPEC_PATH,
};

const handback = (): RunVisit => ({
  nodeId: "issue-coverage",
  report: { outcome: "changes_requested" },
});

function scene(
  decomposed: string,
  visits: RunVisit[] = [],
  filed: string[] | null = null,
) {
  const produced: Record<string, string> = {};
  const reads: string[] = [];
  const tools: Tools = {
    read: async (need) =>
      Buffer.from(need === "decomposition" ? decomposed : ""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const deps: CoverageDeps = {
    readSpec: async (repo, path, ref) => {
      reads.push(`${repo}:${path}@${ref}`);

      return { [SPEC_PATH]: SPEC, [HANDLER_PATH]: HANDLER }[path] ?? null;
    },
    listTree: async () => [SPEC_PATH, HANDLER_PATH],
    filedCoverage: async () => filed,
    visitsOf: async () => [
      ...visits,
      { nodeId: "issue-coverage", report: null },
    ],
  };

  return { handle: issueCoverageHandle(deps), tools, produced, reads };
}

function brief(needs: Record<string, string> = NEEDS) {
  return { visitId: "visit-issue-coverage", iteration: 1, needs };
}

describe("issueCoverageHandle", () => {
  it("reports success with 2 of 2 covered when the tasks name both statements, reading the spec at commit abc123", async () => {
    const { handle, tools, produced, reads } = scene(decomposition([7], [8]));

    const report = await handle(brief(), tools);

    expect({ report, produced, reads }).toEqual({
      report: { outcome: "success" },
      produced: {
        issue_coverage:
          "## Spec coverage\n\n2 of 2 testable spec statements have a task.\n",
      },
      reads: [`re-cinq/lore:${SPEC_PATH}@abc123`],
    });
  });

  it("reports success with 1 of 1 covered for plan p1, whose only statement is FR1", async () => {
    const { handle, tools, produced } = scene(decomposition([7]));

    const report = await handle(brief({ ...NEEDS, plan_id: "p1" }), tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "success" },
      produced: {
        issue_coverage:
          "## Spec coverage\n\n1 of 1 testable spec statements have a task.\n",
      },
    });
  });

  it("sends decompose back with FR2 on line 8 when no coverage round was spent yet", async () => {
    const { handle, tools, produced } = scene(decomposition([7]));

    const report = await handle(brief(), tools);

    expect({
      report,
      namesFr2: produced.issue_coverage?.includes(
        "- line 8: FR2 — The graph renders each node event.",
      ),
    }).toEqual({ report: { outcome: "changes_requested" }, namesFr2: true });
  });

  it("reports success with FR2 still listed once three coverage rounds were spent", async () => {
    const { handle, tools, produced } = scene(decomposition([7]), [
      handback(),
      handback(),
      handback(),
    ]);

    const report = await handle(brief(), tools);

    expect({
      report,
      namesFr2: produced.issue_coverage?.includes("- line 8: FR2"),
    }).toEqual({ report: { outcome: "success" }, namesFr2: true });
  });

  it("fails naming story coverage 0 of 1 filed when the spent run would settle but the story's comments lost FR1", async () => {
    const { handle, tools } = scene(
      decomposition([]),
      [handback(), handback(), handback()],
      [],
    );

    const report = await handle(brief({ ...NEEDS, plan_id: "p1" }), tools);

    expect(report).toEqual({
      outcome: "failed",
      error:
        "the story issue lists 0 of the 1 statements no task names; rerun issues to rewrite it",
    });
  });

  it("reports success when the spent run's story lists FR1 on line 7, the one statement of plan p1 no task names", async () => {
    const { handle, tools } = scene(
      decomposition([]),
      [handback(), handback(), handback()],
      [
        "- line 7: FR1 — The run page streams node events. — https://github.com/re-cinq/lore/blob/abc123/specs/live/spec.md#L7",
      ],
    );

    const report = await handle(brief({ ...NEEDS, plan_id: "p1" }), tools);

    expect(report).toEqual({ outcome: "success" });
  });

  it("sends decompose back naming T006's alreadyWorkingOnIssue, absent from the file it names, with activeTaskByIssue as the hint", async () => {
    const { handle, tools, produced } = scene(
      decompositionWith({
        changes: `Check before the \`alreadyWorkingOnIssue\` guard in \`${HANDLER_PATH}\`.`,
      }),
    );

    const report = await handle(brief(), tools);

    expect({
      report,
      namesGuard: produced.issue_coverage?.includes(
        "- `T006`: `alreadyWorkingOnIssue` (line 1) is not in the files the line names; closest: `activeTaskByIssue`",
      ),
    }).toEqual({ report: { outcome: "changes_requested" }, namesGuard: true });
  });

  it("sends decompose back when T006 quotes a plan block naming the retired apps/floor", async () => {
    const { handle, tools, produced } = scene(
      decompositionWith({
        plan_quotes: [
          "in `issuesLabeled` (`apps/floor/src/events/handlers/github.ts`), before the guard",
        ],
      }),
    );

    const report = await handle(brief(), tools);

    expect({
      report,
      namesRetired: produced.issue_coverage?.includes(
        "- `T006`: `apps/floor` (line 1) is retired",
      ),
    }).toEqual({
      report: { outcome: "changes_requested" },
      namesRetired: true,
    });
  });

  it("reports success when T002 names the pipeline file T001 adds", async () => {
    const { handle, tools } = scene(
      JSON.stringify({
        spec_commit: "abc123",
        stories: [
          {
            title: "Triage",
            tasks: [
              {
                id: "T001",
                description:
                  "Add `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml`.",
                spec_lines: [7],
              },
              {
                id: "T002",
                description:
                  "Wire reproduce into `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml`.",
                spec_lines: [8],
              },
            ],
          },
        ],
      }),
    );

    const report = await handle(brief(), tools);

    expect(report).toEqual({ outcome: "success" });
  });

  it("reports success and produces nothing when the run names no spec", async () => {
    const { handle, tools, produced } = scene(decomposition([7]));
    const { spec_path: _none, ...withoutSpec } = NEEDS;

    const report = await handle(brief(withoutSpec), tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "success" },
      produced: {},
    });
  });

  it("reports failed with the parse error when the decomposition is not JSON", async () => {
    const { handle, tools } = scene("not json");

    expect(await handle(brief(), tools)).toMatchObject({ outcome: "failed" });
  });
});
