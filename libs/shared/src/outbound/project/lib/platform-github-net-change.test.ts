import { describe, expect, it } from "vitest";
import type { Octokit } from "octokit";
import { netChange } from "./platform-github-pulls-read.js";

function github(answer: unknown) {
  const asked: unknown[] = [];
  const compareCommitsWithBasehead = async (params: unknown) => {
    asked.push(params);

    if (answer instanceof Error) {
      throw answer;
    }

    return { data: answer };
  };

  return {
    ok: {
      rest: { repos: { compareCommitsWithBasehead } },
    } as unknown as Octokit,
    asked,
  };
}

describe("netChange", () => {
  it("reads what sha-new changes against main as of their merge base, each file's name, status and patch, and no patch for a file GitHub leaves it out of", async () => {
    const { ok, asked } = github({
      files: [
        {
          filename: "src/a.ts",
          status: "modified",
          patch: "@@ -1 +1 @@\n+a",
          additions: 1,
        },
        { filename: "logo.png", status: "added", additions: 0 },
      ],
    });

    expect({
      change: await netChange(ok, "re-cinq/lore", "main", "sha-new"),
      asked,
    }).toEqual({
      change: [
        { filename: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n+a" },
        { filename: "logo.png", status: "added" },
      ],
      asked: [{ owner: "re-cinq", repo: "lore", basehead: "main...sha-new" }],
    });
  });

  it("answers null when GitHub refuses the compare, as for a commit a rebase left behind", async () => {
    const { ok } = github(new Error("No commit found for SHA: sha-gone"));

    expect(await netChange(ok, "re-cinq/lore", "main", "sha-gone")).toBeNull();
  });
});
