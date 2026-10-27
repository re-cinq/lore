import { describe, expect, it } from "vitest";
import type { Octokit } from "octokit";
import { deleteFile } from "./platform-github-repo-content.js";

function github(blobSha: string | null) {
  const deleted: unknown[] = [];
  const repos = {
    getContent: async () => {
      if (!blobSha) {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      }

      return { data: { type: "file", sha: blobSha } };
    },
    deleteFile: async (params: unknown) => {
      deleted.push(params);

      return { data: {} };
    },
  };

  return { ok: { rest: { repos } } as unknown as Octokit, deleted };
}

describe("deleteFile", () => {
  it("deletes .lore/dod.md from the branch as blob abc, with the message, and answers true", async () => {
    const { ok, deleted } = github("abc");

    expect({
      answer: await deleteFile(
        ok,
        "re-cinq/otto",
        "lore/implementation-loop/issue-7",
        {
          path: ".lore/dod.md",
          message: "Remove the definition of done before review",
        },
      ),
      deleted,
    }).toEqual({
      answer: true,
      deleted: [
        {
          owner: "re-cinq",
          repo: "otto",
          path: ".lore/dod.md",
          branch: "lore/implementation-loop/issue-7",
          message: "Remove the definition of done before review",
          sha: "abc",
        },
      ],
    });
  });

  it("answers false and deletes nothing when the branch has no such file", async () => {
    const { ok, deleted } = github(null);

    expect({
      answer: await deleteFile(ok, "re-cinq/otto", "b", {
        path: ".lore/dod.md",
        message: "m",
      }),
      deleted,
    }).toEqual({ answer: false, deleted: [] });
  });
});
