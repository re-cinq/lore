import { describe, it, expect } from "vitest";
import { defaultTaskPrompt, renderNodePrompt } from "./config.js";

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

describe("a task description carrying $-replacement patterns", () => {
  it("inserts $` and $1 verbatim into the default task prompt", () => {
    expect(defaultTaskPrompt("use $` then $1")).toEqual(
      "Complete the following task: use $` then $1",
    );
  });

  it("inserts $& verbatim into a node prompt", () => {
    expect(
      renderNodePrompt("general", "Task: {description}", "match $& here"),
    ).toEqual("Task: match $& here");
  });
});
