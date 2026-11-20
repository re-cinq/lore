import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".next",
  "build",
  "coverage",
]);

function filesMatching(pattern: RegExp): string[] {
  return ["apps", "libs"]
    .flatMap((root) => productionFiles(path.join(REPO_ROOT, root)))
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(REPO_ROOT, file))
    .sort();
}

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : productionFiles(full);
    }

    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

describe("where a floor client is built and a line is started", () => {
  it("builds a floor client with createFloorClient in floor-client.ts and recorded-floor.ts only", () => {
    expect(filesMatching(/\bcreateFloorClient\b/)).toEqual([
      "libs/shared/src/outbound/floor/floor-client.ts",
      "libs/shared/src/outbound/floor/recorded-floor.ts",
    ]);
  });

  it("takes a client that skips the mirror refusal with floorClientFrom in the files that only read or write definitions", () => {
    expect(filesMatching(/\bfloorClientFrom\b/)).toEqual([
      "apps/lore-api/src/work/floor/floor-migrations.ts",
      "apps/lore-api/src/work/floor/seed-floor-pipelines.ts",
      "apps/lore-api/src/work/pack/production-pack-deps.ts",
      "libs/shared/src/outbound/floor/floor-client.ts",
      "libs/shared/src/outbound/project/lib/project-factory.ts",
    ]);
  });

  it("starts a line with lines.start in floor-line-start.ts, upgrade-run.ts and the mirror-refusal.ts that guards it only", () => {
    expect(filesMatching(/\blines\.start\(/)).toEqual([
      "apps/lore-api/src/work/floor/upgrade-run.ts",
      "libs/shared/src/outbound/floor/mirror-refusal.ts",
      "libs/shared/src/work/review/floor-line-start.ts",
    ]);
  });
});
