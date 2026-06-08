import { describe, it, expect } from "vitest";
import { IssueCollection } from "./issues.js";
import type { GitHubPort, IssueRef } from "../lib/github-port.js";

/**
 * The facade delegates to a GitHubPort with zero heavy deps. The fake is a
 * hand-written object literal (no mock library): real values in, real out.
 */

function fakeGitHub(issues: IssueRef[]): GitHubPort {
  return {
    name: "fake",
    listIssues: async (repo) => issues.filter((i) => i.repo === repo),
    getFileContent: async () => null,
    listDirectory: async () => [],
    listTree: async () => [],
  };
}

describe("Project.issues.list", () => {
  it("returns the GitHubPort issues for the project's repo", async () => {
    const issues: IssueRef[] = [
      { repo: "re-cinq/lore", number: 1, title: "first", state: "open", labels: ["lore-managed"] },
      { repo: "re-cinq/lore", number: 2, title: "second", state: "closed", labels: [] },
      { repo: "other/repo", number: 9, title: "elsewhere", state: "open", labels: [] },
    ];
    const issuesFacade = new IssueCollection("re-cinq/lore", fakeGitHub(issues));

    const result = await issuesFacade.list();

    expect(result).toEqual([
      { repo: "re-cinq/lore", number: 1, title: "first", state: "open", labels: ["lore-managed"] },
      { repo: "re-cinq/lore", number: 2, title: "second", state: "closed", labels: [] },
    ]);
  });
});
