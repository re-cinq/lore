import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadAssemblyLineDir } from "./loader.js";

describe("implementation.yaml — cross-model review interim policy", () => {
  const here = new URL(".", import.meta.url).pathname;
  const assemblyLinesDir = path.resolve(here, "assembly-lines");

  it("pins the review node to a different model than the implement node", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const line = map.get("implementation");
    const implementModel = line?.nodes.find((n) => n.id === "implement")?.model;
    const reviewModel = line?.nodes.find((n) => n.id === "review")?.model;

    expect(implementModel).toBeDefined();
    expect(reviewModel).toBeDefined();
    expect(reviewModel).not.toBe(implementModel);
  });
});
