import { describe, it, expect } from "vitest";
import { RepoFiles } from "./repo-files.js";
import type { GitHubPort } from "../lib/github-port.js";

/**
 * project.repo reads files over the API and performs API-based branch/commit
 * writes (no clone), bound to the repo and passing the ref through.
 */

function fakeGitHub(writes: string[] = []): GitHubPort {
  const files: Record<string, string> = {
    "CLAUDE.md": "# Lore",
    "src/index.ts": "export {};",
  };

  return {
    name: "fake",
    isConfigured: () => true,
    listIssues: async () => [],
    getIssue: async () => null,
    getFileContent: async (repo, path, ref) =>
      repo === "re-cinq/lore" && files[path]
        ? `${files[path]}@${ref ?? "HEAD"}`
        : null,
    listDirectory: async (_repo, path) =>
      path === "src" ? ["src/index.ts"] : [],
    listTree: async () => ["CLAUDE.md", "src/index.ts"],
    getDefaultBranch: async () => "main",
    listCommitsSince: async () => [],
    getIssueLabels: async () => [],
    createIssue: async () => ({
      repo: "re-cinq/lore",
      number: 1,
      title: "",
      state: "open",
      labels: [],
    }),
    createLabels: async () => {},
    commentOnIssue: async () => {},
    closeIssue: async () => {},
    addIssueLabel: async () => {},
    removeIssueLabel: async () => {},
    createBranch: async (_repo, branch, base) => {
      writes.push(`branch:${branch}:${base ?? "main"}`);
    },
    commitFile: async (_repo, branch, path) => {
      writes.push(`commit:${branch}:${path}`);
    },
  };
}

describe("RepoFiles", () => {
  it("reads a file from the repo at the given ref", async () => {
    const repo = new RepoFiles("re-cinq/lore", fakeGitHub());

    expect(await repo.read("CLAUDE.md", "main")).toBe("# Lore@main");
  });

  it("returns null for a file the repo does not have", async () => {
    const repo = new RepoFiles("re-cinq/lore", fakeGitHub());

    expect(await repo.read("missing.txt")).toBeNull();
  });

  it("creates a branch and commits a file via the API, repo bound", async () => {
    const writes: string[] = [];
    const repo = new RepoFiles("re-cinq/lore", fakeGitHub(writes));

    await repo.createBranch("feat", "main");
    await repo.commitFile("feat", "docs/x.md", "hi", "docs: x");

    expect(writes).toEqual(["branch:feat:main", "commit:feat:docs/x.md"]);
  });
});
