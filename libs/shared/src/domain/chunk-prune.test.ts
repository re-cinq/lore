import { describe, it, expect } from "vitest";
import { planChunkPrune } from "./chunk-prune.js";
import { classifyFile } from "./content-classify.js";

describe("planChunkPrune", () => {
  it("plans deletion of apps/lore-api/src/api/routes/features/features.test.ts when it is indexed but absent from the tree", () => {
    expect(
      planChunkPrune(
        [
          "apps/lore-api/src/api/routes/features/features.test.ts",
          "apps/lore-api/src/transport/routes/features/features.test.ts",
        ],
        ["apps/lore-api/src/transport/routes/features/features.test.ts"],
        classifyFile,
      ),
    ).toEqual(["apps/lore-api/src/api/routes/features/features.test.ts"]);
  });

  it("keeps the 2 present paths and plans none when the tree matches", () => {
    const present = ["CLAUDE.md", "specs/x/spec.md"];

    expect(planChunkPrune(present, present, classifyFile)).toEqual([]);
  });

  it("plans deletion of a present path the classifier now refuses, such as apps/web-ui/src/lib/api/schema.d.ts", () => {
    expect(
      planChunkPrune(
        ["apps/web-ui/src/lib/api/schema.d.ts", "CLAUDE.md"],
        ["apps/web-ui/src/lib/api/schema.d.ts", "CLAUDE.md"],
        () => null,
      ),
    ).toEqual(["apps/web-ui/src/lib/api/schema.d.ts", "CLAUDE.md"]);
  });
});
