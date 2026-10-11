import { describe, it, expect } from "vitest";
import {
  parseDecomposition,
  type DecompositionResult,
} from "./decomposition-result.js";

const valid: DecompositionResult = {
  stories: [
    {
      title: "Favorite a repo",
      summary: "Let a developer star a repo and see it in a Favorites list.",
      acceptance_criteria: [
        "A star toggles the favorite",
        "Favorites list shows starred repos",
      ],
      tasks: [
        {
          id: "T001",
          description: "Add favorites join table",
          depends_on: [],
          parallelizable: false,
          phase: 1,
        },
        {
          id: "T002",
          description: "Star button on the repo page",
          depends_on: ["T001"],
          parallelizable: true,
          phase: 2,
          file_path: "web-ui/StarButton.tsx",
        },
      ],
    },
  ],
};

describe("parseDecomposition", () => {
  it("returns the parsed result for a valid stories payload", () => {
    expect(parseDecomposition(structuredClone(valid))).toEqual(valid);
  });

  it("throws when the root is null, an array, or a string", () => {
    for (const bad of [null, [], "{}"]) {
      expect(() => parseDecomposition(bad)).toThrow(/root must be an object/);
    }
  });

  it("throws when stories is missing or not an array", () => {
    expect(() => parseDecomposition({})).toThrow(/stories must be an array/);
    expect(() => parseDecomposition({ stories: "no" })).toThrow(
      /stories must be an array/,
    );
  });

  it("returns an empty result for an explicit empty stories array", () => {
    expect(parseDecomposition({ stories: [] })).toEqual({ stories: [] });
  });

  it("throws when a story has no title", () => {
    expect(() => parseDecomposition({ stories: [{ summary: "x" }] })).toThrow(
      /story.*title/i,
    );
  });

  it("defaults a story's missing summary, acceptance_criteria, and tasks", () => {
    expect(parseDecomposition({ stories: [{ title: "Bare story" }] })).toEqual({
      stories: [
        {
          title: "Bare story",
          summary: "",
          acceptance_criteria: [],
          tasks: [],
        },
      ],
    });
  });

  it("coerces a single-string acceptance_criteria into a list", () => {
    const r = parseDecomposition({
      stories: [{ title: "S", acceptance_criteria: "just one" }],
    });

    expect(r.stories[0].acceptance_criteria).toEqual(["just one"]);
  });

  it("normalizes a task given as a bare string and mints sequential ids", () => {
    const r = parseDecomposition({
      stories: [{ title: "S", tasks: ["do the thing", "do the other"] }],
    });

    expect(r.stories[0].tasks).toEqual([
      {
        id: "T001",
        description: "do the thing",
        depends_on: [],
        parallelizable: false,
        phase: 0,
      },
      {
        id: "T002",
        description: "do the other",
        depends_on: [],
        parallelizable: false,
        phase: 0,
      },
    ]);
  });

  it("normalizes task drift: text instead of description, single-string depends_on, missing id", () => {
    const r = parseDecomposition({
      stories: [
        {
          title: "S",
          tasks: [{ text: "wire it", depends_on: "T000", file_path: "a.ts" }],
        },
      ],
    });

    expect(r.stories[0].tasks[0]).toEqual({
      id: "T001",
      description: "wire it",
      depends_on: ["T000"],
      parallelizable: false,
      phase: 0,
      file_path: "a.ts",
    });
  });

  it("throws when a task has no description or text", () => {
    expect(() =>
      parseDecomposition({
        stories: [{ title: "S", tasks: [{ id: "T001" }] }],
      }),
    ).toThrow(/task.*description/i);
  });

  it("keeps a task's issue detail — title, context, changes, acceptance criteria, test plan and references", () => {
    const [task] = parseDecomposition({
      stories: [
        {
          title: "S",
          tasks: [
            {
              id: "T001",
              description: "Add the issue-triage line stub",
              title: "Add the issue-triage line stub",
              context: "The line every later task fills in.",
              changes: "Create issue-triage.yaml with empty nodes and edges.",
              acceptanceCriteria: ["the loader accepts the file"],
              test_plan: "Run the assembly-lines loader tests.",
              references: "specs/issue-triage/plan.md#assembly-line-graph",
            },
          ],
        },
      ],
    }).stories[0].tasks;

    expect(task).toEqual({
      id: "T001",
      description: "Add the issue-triage line stub",
      depends_on: [],
      parallelizable: false,
      phase: 0,
      title: "Add the issue-triage line stub",
      context: "The line every later task fills in.",
      changes: "Create issue-triage.yaml with empty nodes and edges.",
      acceptance_criteria: ["the loader accepts the file"],
      test_plan: "Run the assembly-lines loader tests.",
      references: ["specs/issue-triage/plan.md#assembly-line-graph"],
    });
  });

  it("keeps the spec lines a task names as positive whole numbers, 57 written as a string included", () => {
    const [task] = parseDecomposition({
      stories: [
        {
          title: "S",
          tasks: [
            {
              id: "T001",
              description: "d",
              spec_lines: [42, "57", 0, 3.5, "x"],
            },
          ],
        },
      ],
    }).stories[0].tasks;

    expect(task.spec_lines).toEqual([{ line: 42 }, { line: 57 }]);
  });

  it("keeps line 7 of specs/b/spec.md and line 42 of specs/a/spec.md when the lines are keyed by spec, a directory naming its spec.md", () => {
    const [task] = parseDecomposition({
      stories: [
        {
          title: "S",
          tasks: [
            {
              id: "T001",
              description: "d",
              spec_lines: { "specs/a/spec.md": [42, 0], "specs/b": ["7"] },
            },
          ],
        },
      ],
    }).stories[0].tasks;

    expect(task.spec_lines).toEqual([
      { file: "specs/a/spec.md", line: 42 },
      { file: "specs/b/spec.md", line: 7 },
    ]);
  });

  it("keeps the commit abc123 the decomposition read the spec at", () => {
    expect(parseDecomposition({ spec_commit: "abc123", stories: [] })).toEqual({
      spec_commit: "abc123",
      stories: [],
    });
  });

  it("leaves a task without issue detail with none of those fields", () => {
    const [task] = parseDecomposition({
      stories: [{ title: "S", tasks: [{ id: "T001", description: "d" }] }],
    }).stories[0].tasks;

    expect(Object.keys(task).sort()).toEqual([
      "depends_on",
      "description",
      "id",
      "parallelizable",
      "phase",
    ]);
  });

  it("keeps the plan passages a task quotes, a single string as a one-item list", () => {
    const [task] = parseDecomposition({
      stories: [
        {
          title: "S",
          tasks: [
            {
              id: "T001",
              description: "Add the reproduce node",
              plan_quotes: "Reproduction runs before any diagnosis.",
            },
          ],
        },
      ],
    }).stories[0].tasks;

    expect(task).toMatchObject({
      plan_quotes: ["Reproduction runs before any diagnosis."],
    });
  });
});
