import { describe, expect, it } from "vitest";
import { fetchPack, type PackReader } from "./fetch-pack.js";

function readerOf(files: Record<string, string>, head = "c0ffee1") {
  const asked: string[] = [];
  const reader: PackReader = {
    headCommit: async (repo, ref) => {
      asked.push(`head ${repo} ${ref}`);

      return head;
    },
    tree: async (repo, commit) => {
      asked.push(`tree ${repo} ${commit}`);

      return Object.keys(files);
    },
    fileText: async (repo, path, commit) => {
      asked.push(`file ${repo} ${path} ${commit}`);

      return files[path];
    },
  };

  return { reader, asked };
}

describe("fetchPack", () => {
  it("reads the configured repo and ref and returns the commit with the pipeline file read at it", async () => {
    const { reader, asked } = readerOf({ "triage/pipeline.yaml": "line: {}" });

    const pack = await fetchPack(reader, { repo: "acme/pack", ref: "prod" });

    expect({ pack, asked }).toEqual({
      pack: {
        commit: "c0ffee1",
        files: [{ path: "triage/pipeline.yaml", text: "line: {}" }],
      },
      asked: [
        "head acme/pack prod",
        "tree acme/pack c0ffee1",
        "file acme/pack triage/pipeline.yaml c0ffee1",
      ],
    });
  });

  it("reads the markdown and YAML of line folders, leaving out the top level and other file types", async () => {
    const { reader } = readerOf({
      "README.md": "# my pack",
      "triage/pipeline.yaml": "a",
      "triage/agents/triager.md": "b",
      "triage/agents/triager.extra.md": "c",
      "triage/notes.txt": "d",
      "triage/agents/deep/x.md": "e",
      "pipeline.yaml": "f",
      "docs/setup.md": "g",
      ".github/workflows/lint.yml": "h",
    });

    const pack = await fetchPack(reader, { repo: "acme/pack", ref: undefined });

    expect(pack.files.map((file) => file.path)).toEqual([
      "triage/pipeline.yaml",
      "triage/agents/triager.md",
      "triage/agents/triager.extra.md",
      "triage/agents/deep/x.md",
    ]);
  });
});
