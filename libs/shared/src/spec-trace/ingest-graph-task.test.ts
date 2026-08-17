import { enforceTrue } from "../lib/enforce.js";
import { describe, it, expect } from "vitest";
import {
  selectIngestFiles,
  summarizeIngest,
  runIngestGraph,
  chunkGlobsForKind,
  type IngestKindDef,
} from "./ingest-graph-task.js";
import type { DgraphClientPort } from "./deps.js";

/**
 * ingest-graph-task — the deterministic, zero-LLM core the agent worker and the
 * local MCP runner both call. Pure helpers (selectIngestFiles, summarizeIngest)
 * and the runIngestGraph orchestrator are exercised here with an INJECTED fake
 * kind registry + fake content source, so no live Dgraph is needed; the real
 * projectSpecFile/projectAdrFile idempotency is covered by their own live tests.
 */

const TREE = [
  "specs/auth/spec.md",
  "specs/auth/plan.md",
  ".specify/overview.md",
  "adrs/0001-auth.md",
  "src/auth.ts",
  "src/auth.test.ts",
  "src/types.d.ts",
  "README.md",
];

describe("selectIngestFiles", () => {
  it("selects specs/ and .specify/ markdown for the specs kind", () => {
    expect(selectIngestFiles(TREE, "specs")).toEqual([
      "specs/auth/spec.md",
      "specs/auth/plan.md",
      ".specify/overview.md",
    ]);
  });

  it("selects only adrs/ markdown for the adrs kind", () => {
    expect(selectIngestFiles(TREE, "adrs")).toEqual(["adrs/0001-auth.md"]);
  });

  it("returns nothing for an unknown kind", () => {
    expect(selectIngestFiles(TREE, "docs")).toEqual([]);
  });

  it("uses manifest globs (replacing the prefix defaults) when patterns are given", () => {
    const tree = [
      "specs/auth/spec.md",
      "design/decisions/x.md",
      "design/draft.md",
      "docs/notes.md",
    ];

    expect(
      selectIngestFiles(tree, "specs", undefined, undefined, [
        "design/**/*.md",
      ]),
    ).toEqual(["design/decisions/x.md", "design/draft.md"]);
  });
});

describe("chunkGlobsForKind", () => {
  it("yields one per-directory glob per top-level specs dir, plus the bare prefix for root-level files", () => {
    const tree = [
      "specs/auth/spec.md",
      "specs/auth/contracts/api.md",
      "specs/billing/plan.md",
      ".specify/overview.md",
      "specs/README.md",
      "src/auth.ts",
    ];

    expect(chunkGlobsForKind("specs", tree)).toEqual([
      ".specify/",
      "specs/",
      "specs/auth/",
      "specs/billing/",
    ]);
  });

  it("collapses the flat adrs kind into its single prefix glob", () => {
    expect(chunkGlobsForKind("adrs", TREE)).toEqual(["adrs/"]);
  });

  it("returns nothing for an unknown kind", () => {
    expect(chunkGlobsForKind("docs", TREE)).toEqual([]);
  });
});

describe("summarizeIngest", () => {
  it("reports completed when everything projected", () => {
    expect(summarizeIngest("specs", 3, 3, 0, [])).toMatchObject({
      status: "completed",
      projected: 3,
      skipped: 0,
      failed: 0,
    });
  });

  it("reports completed when everything was an unchanged skip", () => {
    expect(summarizeIngest("specs", 3, 0, 3, [])).toMatchObject({
      status: "completed",
      skipped: 3,
    });
  });

  it("reports failed only when every attempted file failed", () => {
    expect(summarizeIngest("specs", 2, 0, 0, ["a.md", "b.md"]).status).toBe(
      "failed",
    );
  });

  it("stays completed on a partial failure", () => {
    expect(summarizeIngest("specs", 3, 2, 0, ["c.md"]).status).toBe(
      "completed",
    );
  });
});

function fakeRegistry(): Record<string, IngestKindDef> {
  const seen = new Set<string>();

  return {
    specs: {
      prefixes: ["specs/", ".specify/"],
      runsOn: "runner+local",
      project: async (_repo, filePath, content) => {
        const key = `${filePath}:${content}`;

        if (seen.has(key)) {
          return { projected: false };
        }
        seen.add(key);

        return { projected: true };
      },
    },
  };
}

const DUMMY_DGRAPH = {} as DgraphClientPort;

describe("runIngestGraph", () => {
  it("passes ports.embed through to the kind's project call", async () => {
    const embedsSeen: Array<unknown> = [];
    const stubEmbed = async (): Promise<number[]> => [0.5];
    const registry: Record<string, IngestKindDef> = {
      specs: {
        prefixes: ["specs/"],
        runsOn: "runner+local",
        project: async (_repo, _path, _content, _dgraph, embed) => {
          embedsSeen.push(embed);

          return { projected: true };
        },
      },
    };

    await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => ["specs/a/spec.md"],
        readFile: async () => "x",
        embed: stubEmbed,
      },
      registry,
    );

    expect(embedsSeen[0]).toBe(stubEmbed);
  });

  it("short-circuits to skipped when no dgraph client is configured", async () => {
    const result = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      { dgraph: null, listTree: async () => TREE, readFile: async () => "x" },
    );

    expect(result).toMatchObject({ status: "skipped" });
    expect(result.message).toMatch(/LORE_DGRAPH_HTTP/);
  });

  it("projects then skips identical content on a second run (idempotent)", async () => {
    const registry = fakeRegistry();
    const ports = {
      dgraph: DUMMY_DGRAPH,
      listTree: async () => ["specs/a/spec.md", ".specify/b.md"],
      readFile: async (p: string) => `content of ${p}`,
    };

    const first = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      ports,
      registry,
    );
    const second = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      ports,
      registry,
    );

    expect(first).toMatchObject({
      projected: 2,
      skipped: 0,
      status: "completed",
    });
    expect(second).toMatchObject({
      projected: 0,
      skipped: 2,
      status: "completed",
    });
  });

  function pruneRegistry(
    graphDocPaths: string[],
    opts?: { failProject?: boolean; failDelete?: string; failList?: boolean },
  ): {
    registry: Record<string, IngestKindDef>;
    deleted: string[];
  } {
    const deleted: string[] = [];
    const registry: Record<string, IngestKindDef> = {
      specs: {
        prefixes: ["specs/"],
        runsOn: "runner+local",
        project: async () => {
          enforceTrue(!opts?.failProject, Error, "projection down");

          return { projected: false };
        },
        prune: {
          listDocPaths: async () => {
            enforceTrue(!opts?.failList, Error, "list query down");

            return graphDocPaths;
          },
          deleteSubtree: async (_dgraph, _repo, filePath) => {
            enforceTrue(filePath !== opts?.failDelete, Error, "delete failed");
            deleted.push(filePath);
          },
        },
      },
    };

    return { registry, deleted };
  }

  it("prunes graph docs whose files left the tree even when every current file hash-skips", async () => {
    const { registry, deleted } = pruneRegistry([
      "specs/alive/spec.md",
      "specs/moved/spec.md",
    ]);

    const result = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => ["specs/alive/spec.md"],
        readFile: async () => "x",
      },
      registry,
    );

    expect(deleted).toEqual(["specs/moved/spec.md"]);
    expect(result.pruned).toBe(1);
    expect(result.message).toMatch(/pruned 1/);
  });

  it("does not prune when the tree selection is empty but the graph has docs", async () => {
    const { registry, deleted } = pruneRegistry(["specs/moved/spec.md"]);

    const result = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => [],
        readFile: async () => "x",
      },
      registry,
    );

    expect(deleted).toEqual([]);
    expect(result.pruned).toBeUndefined();
  });

  it("reports pruned as undefined (not 0) when the doc-list read throws", async () => {
    const { registry, deleted } = pruneRegistry(["specs/moved/spec.md"], {
      failList: true,
    });

    const result = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => ["specs/alive/spec.md"],
        readFile: async () => "x",
      },
      registry,
    );

    expect(deleted).toEqual([]);
    expect(result.pruned).toBeUndefined();
    expect(result.status).toBe("completed");
  });

  it("does not prune when every attempted file failed to project", async () => {
    const { registry, deleted } = pruneRegistry(["specs/moved/spec.md"], {
      failProject: true,
    });

    const result = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => ["specs/alive/spec.md"],
        readFile: async () => "x",
      },
      registry,
    );

    expect(deleted).toEqual([]);
    expect(result.status).toBe("failed");
  });

  it("isolates a prune failure so other candidates still prune and ingest completes", async () => {
    const { registry, deleted } = pruneRegistry(
      ["specs/gone-a/spec.md", "specs/gone-b/spec.md", "specs/alive/spec.md"],
      { failDelete: "specs/gone-a/spec.md" },
    );

    const result = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => ["specs/alive/spec.md"],
        readFile: async () => "x",
      },
      registry,
    );

    expect(deleted).toEqual(["specs/gone-b/spec.md"]);
    expect(result).toMatchObject({ status: "completed", pruned: 1 });
  });

  it("scopes pruning by the run's glob so a chunked run leaves other directories alone", async () => {
    const { registry, deleted } = pruneRegistry([
      "specs/auth/spec.md",
      "specs/billing/spec.md",
    ]);

    await runIngestGraph(
      { kind: "specs", repo: "o/r", glob: "specs/auth/" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => ["specs/auth/other.md"],
        readFile: async () => "x",
      },
      registry,
    );

    expect(deleted).toEqual(["specs/auth/spec.md"]);
  });

  it("self-skips the tests kind when no buildTestReport port is provided (cluster)", async () => {
    const result = await runIngestGraph(
      { kind: "tests", repo: "o/r" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => [],
        readFile: async () => "",
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/local/i);
  });

  it("refuses to prune when the tree selection is a small subset of many graph docs", async () => {
    const graphDocPaths = Array.from(
      { length: 10 },
      (_, i) => `specs/s${i}/spec.md`,
    );
    const { registry, deleted } = pruneRegistry(graphDocPaths);

    const result = await runIngestGraph(
      { kind: "specs", repo: "o/r" },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => ["specs/s0/spec.md", "specs/s1/spec.md"],
        readFile: async () => "x",
      },
      registry,
    );

    expect(deleted).toEqual([]);
    expect(result.pruned).toBeUndefined();
  });

  it("force prunes 8 of 10 graph docs where an unforced run refuses the suspicious tree", async () => {
    const graphDocPaths = Array.from(
      { length: 10 },
      (_, i) => `specs/s${i}/spec.md`,
    );
    const { registry, deleted } = pruneRegistry(graphDocPaths);

    const result = await runIngestGraph(
      { kind: "specs", repo: "o/r", force: true },
      {
        dgraph: DUMMY_DGRAPH,
        listTree: async () => ["specs/s0/spec.md", "specs/s1/spec.md"],
        readFile: async () => "x",
      },
      registry,
    );

    expect(deleted).toEqual(graphDocPaths.slice(2));
    expect(result.pruned).toBe(8);
  });
});
