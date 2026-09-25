import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";

/** Test fixtures for the digest modules: one merged PR and one issue, every field overridable. */

export function mergedPr(overrides: Partial<PullRef> = {}): PullRef {
  return {
    repo: "re-cinq/lore",
    number: 1,
    title: "A change",
    branch: "feat/a",
    state: "merged",
    labels: [],
    url: "https://gh/pr/1",
    author: "alice",
    mergedAt: "2026-09-25T06:00:00Z",
    ...overrides,
  };
}

export function closedIssue(overrides: Partial<IssueRef> = {}): IssueRef {
  return {
    repo: "re-cinq/lore",
    number: 12,
    title: "An issue",
    state: "closed",
    labels: [],
    url: "https://gh/i/12",
    assignees: [],
    closedAt: "2026-09-25T06:00:00Z",
    ...overrides,
  };
}

export function openIssue(overrides: Partial<IssueRef> = {}): IssueRef {
  return {
    ...closedIssue({ number: 20, url: "https://gh/i/20" }),
    state: "open",
    closedAt: undefined,
    ...overrides,
  };
}
