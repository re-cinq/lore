import { describe, it, expect } from "vitest";
import { DECOMPOSITION_EXAMPLE } from "./decomposition-instructions.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAgentDefaultFile } from "../agent-defaults/agent-default-file.js";
import { parseDecomposition } from "./decomposition-result.js";

const DECOMPOSITION_INSTRUCTIONS =
  parseAgentDefaultFile(
    "spec-tickets-decompose",
    readFileSync(
      resolve(
        import.meta.dirname,
        "../../agent-defaults/spec-tickets-decompose.md",
      ),
      "utf-8",
    ),
  ).prompt ?? "";

const ISSUE_DETAIL = [
  "title",
  "context",
  "changes",
  "acceptance_criteria",
  "test_plan",
  "references",
  "plan_quotes",
] as const;

function isBlank(value: unknown): boolean {
  return Array.isArray(value) ? value.length === 0 : !value;
}

describe("the shipped spec-tickets-decompose prompt", () => {
  it("documents the output contract — stories, acceptance criteria, and task dependencies", () => {
    for (const token of [
      "stories",
      "acceptance_criteria",
      "depends_on",
      "tasks",
    ]) {
      expect(DECOMPOSITION_INSTRUCTIONS).toContain(token);
    }
  });

  it("frames decomposition as turning the spec into work, not re-planning it", () => {
    expect(DECOMPOSITION_INSTRUCTIONS).toMatch(/user stor/i);
    expect(DECOMPOSITION_INSTRUCTIONS).toMatch(/take the spec as settled/i);
  });
});

describe("DECOMPOSITION_EXAMPLE", () => {
  it("parses cleanly through parseDecomposition", () => {
    const parsed = parseDecomposition(JSON.parse(DECOMPOSITION_EXAMPLE));

    expect(parsed.stories.length).toBeGreaterThan(0);
    expect(parsed.stories[0].tasks.length).toBeGreaterThan(0);
  });

  it("shows a cross-task dependency so the model learns to wire phases", () => {
    const parsed = parseDecomposition(JSON.parse(DECOMPOSITION_EXAMPLE));
    const everyTask = parsed.stories.flatMap((s) => s.tasks);

    expect(everyTask.some((t) => t.depends_on.length > 0)).toBe(true);
  });

  it("writes every example task as a self-contained issue: title, context, changes, acceptance criteria, test plan and references", () => {
    const everyTask = parseDecomposition(
      JSON.parse(DECOMPOSITION_EXAMPLE),
    ).stories.flatMap((s) => s.tasks);
    const missing = everyTask
      .filter((t) => ISSUE_DETAIL.some((field) => isBlank(t[field])))
      .map((t) => t.id);

    expect(missing).toEqual([]);
  });

  it("leaves a closed ticket's task out instead of writing a placeholder for it", () => {
    expect({
      leftOut: DECOMPOSITION_INSTRUCTIONS.includes(
        "A ticket already closed is finished work: leave its task out.",
      ),
      noPlaceholder: DECOMPOSITION_INSTRUCTIONS.includes(
        "Never\n  write a placeholder task for it",
      ),
    }).toEqual({ leftOut: true, noPlaceholder: true });
  });

  it("forbids a catch-all task and caps a task at 8 spec_lines taken from its own missing or partial statements", () => {
    expect({
      noCatchAll: DECOMPOSITION_INSTRUCTIONS.includes(
        "Never write a catch-all task or story",
      ),
      cap: DECOMPOSITION_INSTRUCTIONS.includes("no more than 8 `spec_lines`"),
      ownStatements: DECOMPOSITION_INSTRUCTIONS.includes(
        "Take every `spec_lines` entry from your own `statements` list",
      ),
    }).toEqual({ noCatchAll: true, cap: true, ownStatements: true });
  });

  it("tells the agent each task becomes its own issue a developer implements from alone", () => {
    expect({
      ownIssue: DECOMPOSITION_INSTRUCTIONS.includes(
        "Every task becomes its own GitHub issue",
      ),
      fields: [
        "title",
        "context",
        "changes",
        "acceptance_criteria",
        "test_plan",
        "references",
      ].every((field) => DECOMPOSITION_INSTRUCTIONS.includes(`"${field}"`)),
    }).toEqual({ ownIssue: true, fields: true });
  });
});
