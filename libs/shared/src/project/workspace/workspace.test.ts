import { describe, it, expect } from "vitest";
import { Workspace } from "./workspace.js";
import type { GitPort } from "./git-port.js";

/**
 * The Workspace owns writes over a fake GitPort (the GitCli adapter against real
 * git is the live counterpart). Proves write/commit delegation and that openPr
 * pushes before delegating to the pulls port.
 */

function fakeGit(log: string[]): GitPort {
  const files = new Map<string, string>();
  return {
    clone: async () => {},
    ensureClone: async () => {},
    ensureCheckout: async () => {},
    listBranches: async () => ["main"],
    switchBranch: async (_dir, branch) => {
      log.push(`switch ${branch}`);
    },
    readFile: async (_dir, path) => files.get(path) ?? "",
    writeFile: async (_dir, path, content) => {
      files.set(path, content);
    },
    stageCommit: async (_dir, message) => {
      log.push(`commit ${message}`);
      return { committed: true };
    },
    push: async (_dir, branch) => {
      log.push(`push ${branch}`);
    },
    remove: async () => {},
  };
}

describe("Workspace", () => {
  it("writes then reads back a file and commits through the GitPort", async () => {
    const log: string[] = [];
    const ws = new Workspace("re-cinq/lore", "/tmp/ws", fakeGit(log));

    await ws.writeFile("README.md", "hello");
    const back = await ws.readFile("README.md");
    await ws.commit("docs: add readme");

    expect(back).toBe("hello");
    expect(log).toEqual(["commit docs: add readme"]);
  });

  it("pushes the branch then opens the PR via the pulls port", async () => {
    const log: string[] = [];
    const opened: string[] = [];
    const ws = new Workspace("re-cinq/lore", "/tmp/ws", fakeGit(log), {
      list: async () => [],
      get: async () => null,
      comment: async () => {},
      review: async () => {},
      addLabel: async () => {},
      merge: async () => {},
      open: async (repo, branch, title) => {
        opened.push(`${repo}#${branch}`);
        return {
          repo,
          number: 1,
          title,
          branch,
          state: "open",
          labels: [],
          url: "https://gh/pr/1",
        };
      },
      getDiff: async () => "",
      listReviews: async () => [],
      listComments: async () => [],
      listIssueComments: async () => [],
      listCommits: async () => [],
      isMerged: async () => false,
      isClosed: async () => false,
      getStats: async () => ({
        files_changed: 0,
        additions: 0,
        deletions: 0,
        comments: 0,
        merged_at: null,
        created_at: "",
      }),
      changedFileCount: async () => 0,
      ciConclusion: async () => "none" as const,
      listFiles: async () => [],
      listChecks: async () => [],
    });

    const pr = await ws.openPr("feat", "Add feature", "body");

    expect(log).toEqual(["push feat"]);
    expect(opened).toEqual(["re-cinq/lore#feat"]);
    expect(pr.number).toBe(1);
  });
});
