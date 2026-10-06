import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

const { layers } = parse(
  readFileSync(path.join(REPO_ROOT, "layers.yaml"), "utf8"),
) as { layers: Record<string, Record<string, string[]>> };

describe("layers.yaml", () => {
  it("maps every folder of apps/stations to the list of what it may import", () => {
    const folders = Object.values(layers["apps/stations"]);

    expect(folders.every((allowed) => Array.isArray(allowed))).toBe(true);
  });

  it("governs no package whose folder is gone, apps/floor included", () => {
    const gone = Object.keys(layers).filter(
      (pkg) => !existsSync(path.join(REPO_ROOT, pkg)),
    );

    expect(gone).toEqual([]);
  });
});
