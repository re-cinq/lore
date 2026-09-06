import { describe, it, expect } from "vitest";
import { selectSeedFiles } from "./reindex.js";

describe("selectSeedFiles", () => {
  it("includes nested specs/<feature> docs alongside CLAUDE.md, AGENTS.md, adrs, and .specify", () => {
    const tree = [
      "CLAUDE.md",
      "AGENTS.md",
      "adrs/ADR-001-foo.md",
      "specs/feature-a/spec.md",
      "specs/feature-a/data-model.md",
      "specs/feature-a/tasks.md",
      ".specify/spec.md",
      "src/index.ts",
      "README.md",
      "specs/feature-a/diagram.png",
    ];

    expect(selectSeedFiles(tree)).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      "adrs/ADR-001-foo.md",
      "specs/feature-a/spec.md",
      "specs/feature-a/data-model.md",
      "specs/feature-a/tasks.md",
      ".specify/spec.md",
    ]);
  });

  it("excludes source code and root docs outside the seed roots", () => {
    expect(
      selectSeedFiles(["src/app.ts", "README.md", "package.json"]),
    ).toEqual([]);
  });

  it("excludes binary and unsupported files under the seed roots", () => {
    expect(
      selectSeedFiles([
        "specs/x/logo.svg",
        "adrs/diagram.png",
        "specs/y/font.woff2",
      ]),
    ).toEqual([]);
  });
});
