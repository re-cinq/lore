import { describe, expect, it } from "vitest";
import { fetchPack, type PackReader } from "./fetch-pack.js";

function fakeGitHubReader(files: Record<string, string>, head = "a1b2c3d") {
  const queries: string[] = [];
  const reader: PackReader = {
    headCommit: async (repo, ref) => {
      queries.push(`head ${repo}@${ref ?? "default"}`);

      return head;
    },
    tree: async (repo, commit) => {
      queries.push(`tree ${repo}@${commit}`);

      return Object.keys(files);
    },
    fileText: async (repo, path, commit) => {
      queries.push(`file ${repo}:${path}@${commit}`);

      return files[path] ?? "";
    },
  };

  return { reader, queries };
}

describe("fetchPack", () => {
  it("fetches the correct pack repository via GitHub client", async () => {
    const { reader, queries } = fakeGitHubReader({
      "triage/pipeline.yaml": "line: {}",
    });

    const fetched = await fetchPack(reader, {
      repo: "re-cinq/pack-repo",
      ref: "main",
    });

    expect({ fetched, queries }).toEqual({
      fetched: {
        commit: "a1b2c3d",
        files: [{ path: "triage/pipeline.yaml", text: "line: {}" }],
      },
      queries: [
        "head re-cinq/pack-repo@main",
        "tree re-cinq/pack-repo@a1b2c3d",
        "file re-cinq/pack-repo:triage/pipeline.yaml@a1b2c3d",
      ],
    });
  });
});
