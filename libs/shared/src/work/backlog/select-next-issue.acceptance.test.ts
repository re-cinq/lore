import { describe, expect, it } from "vitest";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import { selectNextIssue } from "./select-next-issue.js";

function issue(overrides: Partial<IssueRef> & { number: number }): IssueRef {
  return {
    repo: "acme/widgets",
    title: `Issue #${overrides.number}`,
    state: "open",
    labels: [],
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("Backlog ranking configuration", () => {
  it("A repo whose settings reorder the criteria gets a different pick from the same backlog, with no code change; a test builds one fixture backlog and asserts two orderings ([validated by selectNextIssue])", () => {
    const issues = [
      issue({
        number: 1,
        labels: ["priority:medium"],
        createdAt: "2026-08-01T00:00:00Z",
        unblocksCount: 0,
      }),
      issue({
        number: 2,
        labels: ["priority:low"],
        createdAt: "2026-08-02T00:00:00Z",
        unblocksCount: 2,
      }),
    ];

    const defaultPick = selectNextIssue(issues, {
      criteria: ["priority", "age"],
    });

    expect(defaultPick?.number).toBe(1);

    const reorderedPick = selectNextIssue(issues, {
      criteria: ["unblocks", "priority", "age"],
    });

    expect(reorderedPick?.number).toBe(2);
  });

  it("With `unblocks` ranked first, a fixture issue that two others depend on is picked ahead of an older one nothing depends on ([validated by selectNextIssue])", () => {
    const issues = [
      issue({
        number: 1,
        labels: ["priority:high"],
        createdAt: "2026-07-01T00:00:00Z",
        unblocksCount: 0,
      }),
      issue({
        number: 2,
        labels: ["priority:high"],
        createdAt: "2026-08-01T00:00:00Z",
        unblocksCount: 2,
      }),
    ];
    const pick = selectNextIssue(issues, { criteria: ["unblocks", "age"] });

    expect(pick?.number).toBe(2);
  });

  it("With `size` ranked first, `size:S` is picked ahead of `size:L` at equal priority ([validated by selectNextIssue])", () => {
    const issues = [
      issue({ number: 1, labels: ["priority:medium", "size:L"] }),
      issue({ number: 2, labels: ["priority:medium", "size:S"] }),
    ];
    const pick = selectNextIssue(issues, {
      criteria: ["size", "priority", "age"],
    });

    expect(pick?.number).toBe(2);
  });
});
