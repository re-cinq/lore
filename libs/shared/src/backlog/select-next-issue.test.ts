import { describe, expect, it } from "vitest";
import type { IssueRef } from "../project/lib/github-port.js";
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

describe("selectNextIssue", () => {
  it("returns null for an empty backlog", () => {
    expect(selectNextIssue([])).toBeNull();
  });

  it("returns null when no issue carries a priority label", () => {
    const issues = [
      issue({ number: 1, labels: ["bug"] }),
      issue({ number: 2, labels: ["lore"] }),
    ];

    expect(selectNextIssue(issues)).toBeNull();
  });

  it("picks priority:high before priority:medium before priority:low", () => {
    const issues = [
      issue({ number: 1, labels: ["priority:low"] }),
      issue({ number: 2, labels: ["priority:high"] }),
      issue({ number: 3, labels: ["priority:medium"] }),
    ];

    expect(selectNextIssue(issues)?.number).toBe(2);
  });

  it("picks priority:medium when no priority:high exists", () => {
    const issues = [
      issue({ number: 1, labels: ["priority:low"] }),
      issue({ number: 3, labels: ["priority:medium"] }),
    ];

    expect(selectNextIssue(issues)?.number).toBe(3);
  });

  it("breaks a priority tie by oldest createdAt", () => {
    const issues = [
      issue({
        number: 8,
        labels: ["priority:high"],
        createdAt: "2026-08-20T00:00:00Z",
      }),
      issue({
        number: 5,
        labels: ["priority:high"],
        createdAt: "2026-08-02T00:00:00Z",
      }),
      issue({
        number: 9,
        labels: ["priority:high"],
        createdAt: "2026-08-10T00:00:00Z",
      }),
    ];

    expect(selectNextIssue(issues)?.number).toBe(5);
  });

  it("skips a closed issue even at higher priority", () => {
    const issues = [
      issue({ number: 1, state: "closed", labels: ["priority:high"] }),
      issue({ number: 2, labels: ["priority:low"] }),
    ];

    expect(selectNextIssue(issues)?.number).toBe(2);
  });

  it("skips an issue labeled lore:blocked", () => {
    const issues = [
      issue({ number: 1, labels: ["priority:high", "lore:blocked"] }),
      issue({ number: 2, labels: ["priority:medium"] }),
    ];

    expect(selectNextIssue(issues)?.number).toBe(2);
  });

  it("treats more than one priority label as ineligible rather than picking the highest", () => {
    const issues = [
      issue({ number: 1, labels: ["priority:high", "priority:low"] }),
      issue({ number: 2, labels: ["priority:medium"] }),
    ];

    expect(selectNextIssue(issues)?.number).toBe(2);
  });

  it("returns null when every candidate is ineligible", () => {
    const issues = [
      issue({ number: 1, labels: ["priority:high", "priority:medium"] }),
      issue({ number: 2, labels: ["priority:low", "lore:blocked"] }),
      issue({ number: 3, state: "closed", labels: ["priority:high"] }),
    ];

    expect(selectNextIssue(issues)).toBeNull();
  });

  it("orders an issue without createdAt after dated peers of the same priority", () => {
    const issues = [
      issue({ number: 1, labels: ["priority:high"], createdAt: undefined }),
      issue({
        number: 2,
        labels: ["priority:high"],
        createdAt: "2026-08-20T00:00:00Z",
      }),
    ];

    expect(selectNextIssue(issues)?.number).toBe(2);
  });

  it("ignores unrelated labels alongside the priority label", () => {
    const issues = [
      issue({ number: 4, labels: ["bug", "priority:low", "area:floor"] }),
    ];

    expect(selectNextIssue(issues)?.number).toBe(4);
  });
});
