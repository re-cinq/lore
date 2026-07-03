import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import { createDetectTickHandler } from "./fan-out.js";

describe("createDetectTickHandler", () => {
  it("starts one spec-drift assembly line per target repo", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const listed: number[] = [];
    const handler = createDetectTickHandler("spec-drift", {
      assemblyLines,
      listTargetRepos: async () => {
        listed.push(1);
        return ["re-cinq/lore", "re-cinq/other"];
      },
    });

    await handler({});

    expect(listed).toHaveLength(1);
    expect(assemblyLines.rows.map((r) => ({ definitionName: r.definitionName, repo: r.repo }))).toEqual([
      { definitionName: "spec-drift", repo: "re-cinq/lore" },
      { definitionName: "spec-drift", repo: "re-cinq/other" },
    ]);
  });

  it("params.repo restricts the fan-out to that repo without enumerating", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const handler = createDetectTickHandler("gap-detect", {
      assemblyLines,
      listTargetRepos: async () => {
        throw new Error("must not enumerate on a single-repo tick");
      },
    });

    await handler({ repo: "re-cinq/lore" });

    expect(assemblyLines.rows).toEqual([
      expect.objectContaining({ definitionName: "gap-detect", repo: "re-cinq/lore" }),
    ]);
  });

  it("no target repos starts nothing", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const handler = createDetectTickHandler("spec-coverage-validate", {
      assemblyLines,
      listTargetRepos: async () => [],
    });

    await handler({});

    expect(assemblyLines.rows).toEqual([]);
  });
});
