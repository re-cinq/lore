import { describe, expect, it } from "vitest";
import { commitsAnswerLine } from "./commits-answer.js";

const walk = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    branch: "main",
    from: "c0c0c0c0c0",
    to: "c2c2c2c2c2",
    commits: 2,
    created: 3,
    updated: 1,
    unchanged: 0,
    failed: [],
    ...over,
  });

describe("commitsAnswerLine", () => {
  it("reads 2 commits from c0c0c0c to c2c2c2c with the counts from a 200", () => {
    expect(commitsAnswerLine({ status: 200, body: walk() })).toBe(
      "2 commits from c0c0c0c to c2c2c2c: 3 created, 1 updated, 0 unchanged",
    );
  });

  it("names the commit a walk from the root stopped at", () => {
    expect(
      commitsAnswerLine({
        status: 200,
        body: walk({ from: null, failed: ["c3: Utopia answered 503"] }),
      }),
    ).toBe(
      "2 commits from the root to c2c2c2c: 3 created, 1 updated, 0 unchanged; stopped at c3: Utopia answered 503",
    );
  });

  it("reads feat/x: not the default branch from a skipped walk", () => {
    expect(
      commitsAnswerLine({
        status: 200,
        body: walk({ branch: "feat/x", skipped: "not the default branch" }),
      }),
    ).toBe("feat/x: not the default branch");
  });

  it("reads a 409 and a 503 as skips, and a 500 as the refusal it was", () => {
    expect([
      commitsAnswerLine({ status: 409, body: '{"code":"utopia_not_set_up"}' }),
      commitsAnswerLine({ status: 503, body: "" }),
      commitsAnswerLine({ status: 500, body: "boom" }),
    ]).toEqual([
      "skipped, no Utopia source for this repo",
      "skipped, no Utopia on this deployment",
      "HTTP 500 boom",
    ]);
  });

  it("reads a 200 carrying an HTML page as unreadable", () => {
    expect(commitsAnswerLine({ status: 200, body: "<html>" })).toBe(
      "HTTP 200 with an unreadable body <html>",
    );
  });
});
