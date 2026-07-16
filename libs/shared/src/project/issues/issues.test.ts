import { describe, it, expect } from "vitest";
import { IssueCollection } from "./issues.js";
import type { GitHubPort, IssueRef } from "../lib/github-port.js";

/**
 * The facade delegates to a GitHubPort with zero heavy deps. The fake is a
 * hand-written object literal (no mock library): real values in, real out.
 */

function fakeGitHub(issues: IssueRef[], calls: string[] = []): GitHubPort {
  return {
    name: "fake",
    isConfigured: () => true,
    listIssues: async (repo) => issues.filter((i) => i.repo === repo),
    getIssue: async (repo, number) =>
      issues.find((i) => i.repo === repo && i.number === number) ?? null,
    getFileContent: async () => null,
    listDirectory: async () => [],
    listTree: async () => [],
    getDefaultBranch: async () => "main",
    listCommitsSince: async () => [],
    getIssueLabels: async (_repo, number) =>
      issues.find((i) => i.number === number)?.labels ?? [],
    createIssue: async (repo, title, body, labels) => {
      const ref: IssueRef = {
        repo,
        number: 42,
        title,
        state: "open",
        labels: labels ?? [],
        url: "u",
      };

      issues.push(ref);

      return ref;
    },
    createLabels: async () => {},
    commentOnIssue: async (_repo, number, body) => {
      calls.push(`comment:${number}:${body}`);
    },
    closeIssue: async (_repo, number, reason) => {
      calls.push(`close:${number}:${reason ?? "completed"}`);
    },
    addIssueLabel: async (_repo, number, label) => {
      calls.push(`addLabel:${number}:${label}`);
    },
    removeIssueLabel: async (_repo, number, label) => {
      calls.push(`removeLabel:${number}:${label}`);
    },
    createBranch: async () => {},
    commitFile: async () => {},
    upsertCheckRun: async () => {},
  };
}

describe("IssueCollection", () => {
  it("returns the GitHubPort issues for the project's repo", async () => {
    const issues: IssueRef[] = [
      {
        repo: "re-cinq/lore",
        number: 1,
        title: "first",
        state: "open",
        labels: ["lore-managed"],
      },
      {
        repo: "re-cinq/lore",
        number: 2,
        title: "second",
        state: "closed",
        labels: [],
      },
      {
        repo: "other/repo",
        number: 9,
        title: "elsewhere",
        state: "open",
        labels: [],
      },
    ];
    const facade = new IssueCollection("re-cinq/lore", fakeGitHub(issues));

    expect(await facade.list()).toEqual([
      {
        repo: "re-cinq/lore",
        number: 1,
        title: "first",
        state: "open",
        labels: ["lore-managed"],
      },
      {
        repo: "re-cinq/lore",
        number: 2,
        title: "second",
        state: "closed",
        labels: [],
      },
    ]);
  });

  it("creates an issue bound to the repo", async () => {
    const facade = new IssueCollection("re-cinq/lore", fakeGitHub([]));

    expect(
      await facade.create("title", "body", ["lore-managed"]),
    ).toMatchObject({
      repo: "re-cinq/lore",
      number: 42,
      title: "title",
      labels: ["lore-managed"],
    });
  });

  it("comments, closes, and labels by number bound to the repo", async () => {
    const calls: string[] = [];
    const facade = new IssueCollection("re-cinq/lore", fakeGitHub([], calls));

    await facade.comment(7, "hi");
    await facade.close(7, "not_planned");
    await facade.addLabel(7, "approved");
    await facade.removeLabel(7, "awaiting-approval");

    expect(calls).toEqual([
      "comment:7:hi",
      "close:7:not_planned",
      "addLabel:7:approved",
      "removeLabel:7:awaiting-approval",
    ]);
  });
});
