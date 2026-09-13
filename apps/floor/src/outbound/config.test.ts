import { describe, it, expect, afterAll, afterEach, beforeAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt, loadTaskTypes, renderNodePrompt } from "./config.js";

const FIXTURES = mkdtempSync(join(tmpdir(), "lore-task-types-"));
const CONFIG = join(FIXTURES, "task-types.yaml");

afterAll(() => {
  rmSync(FIXTURES, { recursive: true, force: true });
});

beforeAll(() => {
  writeFileSync(
    CONFIG,
    [
      "task_types:",
      "  general:",
      "    prompt_template: |",
      "      Complete the following task.",
      "      Task: {description}",
      "  push-only:",
      "    prompt_template: |",
      "      Deliver the work already in the worktree, then git push.",
      "      Context: {description}",
      "",
    ].join("\n"),
  );
  loadTaskTypes(CONFIG);
});

describe("renderNodePrompt", () => {
  it("returns the resolved recipe with the description substituted", () => {
    expect(
      renderNodePrompt(
        "push-only",
        "Deliver the work already in the worktree, then git push.\nContext: {description}\n",
        "ship the spec",
      ),
    ).toEqual(
      "Deliver the work already in the worktree, then git push.\nContext: ship the spec\n",
    );
  });

  it("throws naming the ref when the recipe resolved to nothing, rather than running another one", () => {
    expect(() => renderNodePrompt("no-such-recipe", null, "anything")).toThrow(
      /no prompt named "no-such-recipe"/,
    );
  });

  it("throws on a recipe whose prompt is empty, the row shape a half-edited definition leaves", () => {
    expect(() => renderNodePrompt("tdd-round", "", "anything")).toThrow(
      /no prompt named "tdd-round"/,
    );
  });
});

describe("buildPrompt", () => {
  it("keeps falling back to general for an unknown TASK type", () => {
    expect(buildPrompt("unknown-task-type", "do a thing")).toEqual(
      "Complete the following task.\nTask: do a thing\n",
    );
  });
});

describe("loadTaskTypes drift reporting", () => {
  const warnings: string[] = [];
  const realWarn = console.warn;

  afterEach(() => {
    console.warn = realWarn;
    warnings.length = 0;
    loadTaskTypes(CONFIG);
  });

  const loadFixture = (name: string, yaml: string) => {
    const path = join(FIXTURES, name);

    writeFileSync(path, yaml);
    console.warn = (message: string) => warnings.push(message);
    loadTaskTypes(path);

    return warnings.join("\n");
  };

  it("warns naming the fields a lagging task-types.yaml omits", () => {
    const warned = loadFixture(
      "partial.yaml",
      "task_types:\n  general:\n    prompt_template: Do {description}\n",
    );

    expect(warned).toContain(
      "task_types.general: timeout_minutes — Invalid input: expected number, received undefined",
    );
  });

  it("names the entry itself when an entry has no body at all", () => {
    const warned = loadFixture("bodyless.yaml", "task_types:\n  general:\n");

    expect(warned).toContain(
      "task_types.general: <entry> — Invalid input: expected object",
    );
  });

  it("reads an entry with no body as empty rather than as null", () => {
    loadFixture("bodyless.yaml", "task_types:\n  general:\n");

    expect(buildPrompt("general", "ship it")).toEqual(
      "Complete the following task: ship it",
    );
  });
});

describe("a task description carrying $-replacement patterns", () => {
  it("inserts $` and $1 verbatim into the general template", () => {
    expect(buildPrompt("general", "use $` then $1")).toContain(
      "Task: use $` then $1",
    );
  });

  it("inserts $& verbatim into a node prompt", () => {
    expect(
      renderNodePrompt("general", "Task: {description}", "match $& here"),
    ).toEqual("Task: match $& here");
  });
});
