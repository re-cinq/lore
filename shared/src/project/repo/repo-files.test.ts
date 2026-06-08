import { describe, it, expect } from "vitest";
import { RepoFiles } from "./repo-files.js";
import type { GitHubPort } from "../lib/github-port.js";

/**
 * project.repo reads files over the API, bound to the repo and passing the ref
 * through.
 */

function fakeGitHub(): GitHubPort {
  const files: Record<string, string> = { "CLAUDE.md": "# Lore", "src/index.ts": "export {};" };
  return {
    name: "fake",
    listIssues: async () => [],
    getFileContent: async (repo, path, ref) =>
      repo === "re-cinq/lore" && files[path] ? `${files[path]}@${ref ?? "HEAD"}` : null,
    listDirectory: async (_repo, path) => (path === "src" ? ["src/index.ts"] : []),
    listTree: async () => ["CLAUDE.md", "src/index.ts"],
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
});
