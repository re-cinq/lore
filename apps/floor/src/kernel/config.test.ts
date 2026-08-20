import { describe, it, expect, afterAll, afterEach, beforeAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNodePrompt, buildPrompt, loadTaskTypes } from "./config.js";

// One throwaway directory for every fixture this file writes, removed when it
// finishes — a pid-named file in /tmp outlives the run and the next one reads
// whatever the last one left.
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

describe("buildNodePrompt", () => {
  it("returns the named recipe with the description substituted", () => {
    expect(buildNodePrompt("push-only", "ship the spec")).toEqual(
      "Deliver the work already in the worktree, then git push.\nContext: ship the spec\n",
    );
  });

  it("throws naming the missing recipe rather than running another one", () => {
    expect(() => buildNodePrompt("no-such-recipe", "anything")).toThrow(
      /no prompt template named "no-such-recipe"/,
    );
  });

  it("lists the recipes it does know, so a typo is diagnosable from the error", () => {
    expect(() => buildNodePrompt("push_only", "anything")).toThrow(
      /known: general, push-only/,
    );
  });

  it("never substitutes the general recipe for an unknown node ref", () => {
    let message = "";

    try {
      buildNodePrompt("missing", "ship the spec");
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).not.toContain("Complete the following task");
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

  // `loadTaskTypes` writes module state every test in this file reads, so the
  // restore is a declared hook rather than a `finally` inside one test — the
  // next test to be added does not have to know it needs one.
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

    expect(warned).toContain("task_types.general: timeout_minutes — Required");
  });

  it("names the entry itself when an entry has no body at all", () => {
    const warned = loadFixture("bodyless.yaml", "task_types:\n  general:\n");

    expect(warned).toContain("task_types.general: <entry> — Expected object");
  });

  it("reads an entry with no body as empty rather than as null", () => {
    loadFixture("bodyless.yaml", "task_types:\n  general:\n");

    // The diagnostic above is what a stale ConfigMap should produce. Keeping the
    // null verbatim would instead throw a raw TypeError out of buildNodePrompt.
    expect(() => buildNodePrompt("general", "ship it")).toThrow(
      new Error(
        'task type "general" declares no prompt_template — the loaded task-types.yaml is older than this code',
      ),
    );
  });
});
