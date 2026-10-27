import { describe, it, expect } from "vitest";
import { parsePackageJsonEdges } from "./derive-code-graph.js";

describe("parsePackageJsonEdges", () => {
  it("derives a depends-on edge from a package.json with a github: specifier", () => {
    const content = JSON.stringify({
      name: "my-consumer",
      dependencies: { "my-library": "github:my-org/my-library" },
    });

    const edges = parsePackageJsonEdges(content, "my-org/my-consumer");

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

    expect(edges[0].properties.pinned).toBe(false);
  });

  it("marks a github: specifier with a commit ref as pinned", () => {
    const content = JSON.stringify({
      name: "my-consumer",
      dependencies: { "my-library": "github:my-org/my-library#abc1234" },
    });

    const edges = parsePackageJsonEdges(content, "my-org/my-consumer");

    expect(edges[0].properties.pinned).toBe(true);
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

  it("derives edges from any repo without an auto_ingest_graph opt-in", () => {
    const content = JSON.stringify({
      name: "another-consumer",
      dependencies: { "a-lib": "github:other-org/a-lib" },
    });

    const edges = parsePackageJsonEdges(content, "other-org/another-consumer");

    expect(edges[0].relation).toBe("depends-on");
    expect(edges[0].sourceName).toBe("other-org/another-consumer");
  });
});
