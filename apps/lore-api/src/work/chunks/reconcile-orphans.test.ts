import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));
vi.mock("./prune-orphans.js", () => ({ pruneOrphanChunks: vi.fn() }));

import { projectFor } from "../../outbound/project-boot.js";
import { pruneOrphanChunks } from "./prune-orphans.js";
import { reconcileOrphanChunks } from "./reconcile-orphans.js";

const withTree = (paths: string[]) =>
  vi
    .mocked(projectFor)
    .mockResolvedValue({ repo: { tree: async () => paths } } as never);

describe("reconcileOrphanChunks", () => {
  beforeEach(() => {
    vi.mocked(projectFor).mockReset();
    vi.mocked(pruneOrphanChunks).mockReset();
  });

  it("prunes re-cinq/lore against the tree it read, with no paths from the caller", async () => {
    withTree(["CLAUDE.md", "libs/shared/src/index.ts"]);
    vi.mocked(pruneOrphanChunks).mockResolvedValue({
      schema: "platform",
      deleted_paths: ["apps/floor/src/jobs/merge/auto-merge.ts"],
      deleted_chunks: 4,
    });

    const result = await reconcileOrphanChunks(
      {} as never,
      "re-cinq/lore",
      "main",
    );

    expect({
      posted: vi.mocked(pruneOrphanChunks).mock.calls[0][2],
      deleted: result?.deleted_chunks,
    }).toEqual({
      posted: ["CLAUDE.md", "libs/shared/src/index.ts"],
      deleted: 4,
    });
  });

  it("deletes nothing when the tree reads empty, because that is a failed read and not an empty repo", async () => {
    withTree([]);

    const result = await reconcileOrphanChunks({} as never, "re-cinq/lore");

    expect({
      result,
      pruned: vi.mocked(pruneOrphanChunks).mock.calls.length,
    }).toEqual({ result: null, pruned: 0 });
  });
});
