import { describe, it, expect, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNodePrompt, buildPrompt, loadTaskTypes } from "./config.js";

const CONFIG = join(tmpdir(), `lore-task-types-${process.pid}.yaml`);

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
