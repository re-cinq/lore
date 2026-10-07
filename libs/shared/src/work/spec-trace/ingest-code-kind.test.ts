import { describe, it, expect } from "vitest";
import { selectIngestFiles } from "./ingest-graph-task.js";

describe("selectIngestFiles for the code kind", () => {
  const TREE = [
    "src/auth.ts",
    "src/user.ts",
    "specs/auth/spec.md",
    "adrs/0001-auth.md",
    "README.md",
  ];

  it("selects TypeScript source files for the code kind", () => {
    const selected = selectIngestFiles(TREE, "code");

    expect(selected).toEqual(["src/auth.ts", "src/user.ts"]);
  });
});
