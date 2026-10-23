import { describe, it, expect } from "vitest";
import { parsePackageJsonEdges } from "./derive-code-graph.js";

// specs/lore-derived-code-graph/spec.md#1
describe("parsePackageJsonEdges", () => {
  it("derives a depends-on edge from a package.json with a github: specifier (specs/lore-derived-code-graph/spec.md#1)", () => {
    const content = JSON.stringify({
      name: "my-consumer",
      dependencies: { "my-library": "github:my-org/my-library" },
    });

    const edges = parsePackageJsonEdges(content, "my-org/my-consumer");

    expect(edges).toHaveLength(1);
    expect(edges[0].relation).toBe("depends-on");
    expect(edges[0].sourceName).toBe("my-org/my-consumer");
    expect(edges[0].targetName).toBe("my-library");
  });

  it("marks a github: specifier without a commit ref as not pinned", () => {
    const content = JSON.stringify({
      name: "my-consumer",
      dependencies: { "my-library": "github:my-org/my-library" },
    });

    const edges = parsePackageJsonEdges(content, "my-org/my-consumer");

    expect(edges[0].pinned).toBe(false);
  });

  it("marks a github: specifier with a commit ref as pinned", () => {
    const content = JSON.stringify({
      name: "my-consumer",
      dependencies: { "my-library": "github:my-org/my-library#abc1234" },
    });

    const edges = parsePackageJsonEdges(content, "my-org/my-consumer");

    expect(edges[0].pinned).toBe(true);
  });

  it("returns empty for invalid JSON", () => {
    expect(
      parsePackageJsonEdges("not json", "my-org/my-consumer"),
    ).toHaveLength(0);
  });

  it("derives edges from peerDependencies too", () => {
    const content = JSON.stringify({
      name: "my-consumer",
      peerDependencies: { react: "^18.0.0" },
    });

    const edges = parsePackageJsonEdges(content, "my-org/my-consumer");

    expect(edges.some((e) => e.targetName === "react")).toBe(true);
  });
});
