import { describe, it, expect } from "vitest";
import { selectIngestFiles } from "./ingest-graph-task.js";

// #1768 unmet criterion: nothing writes CodeChunk.references because no
// ingest kind selects source files for projection. When the code kind is
// added to INGEST_KINDS, selectIngestFiles must return TypeScript source
// files so projectCodeFile can mint CodeChunk nodes and wire up
// extractImportedCallSites to write CodeChunk.references edges.
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

    expect(selected).toContain("src/auth.ts");
    expect(selected).toContain("src/user.ts");
    expect(selected).not.toContain("specs/auth/spec.md");
    expect(selected).not.toContain("adrs/0001-auth.md");
  });
});
