import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import { scanForBackfill, BACKFILL_SPECS_PER_REPO } from "./backfill-scan.js";
import type { BackfillScanDeps } from "./backfill-scan.js";

const deps = (over: Partial<BackfillScanDeps> = {}): BackfillScanDeps => ({
  repos: async () => ["o/r"],
  specsFor: async () => ["specs/a/spec.md", "specs/b/spec.md"],
  startBackfill: async () => "run",
  ...over,
});

describe("scanForBackfill", () => {
  it("starts one unit per specification, not one per repository", async () => {
    const started: Array<{ repo: string; specPath: string }> = [];

    await scanForBackfill(
      deps({
        startBackfill: async (repo, specPath) => {
          started.push({ repo, specPath });

          return "run";
        },
      }),
    );

    expect(started).toEqual([
      { repo: "o/r", specPath: "specs/a/spec.md" },
      { repo: "o/r", specPath: "specs/b/spec.md" },
    ]);
  });

  it("caps how many specs one repository may open in a run", async () => {
    const started: string[] = [];
    const many = Array.from({ length: BACKFILL_SPECS_PER_REPO + 5 }, (_, i) =>
      `specs/s${i}/spec.md`,
    );

    await scanForBackfill(
      deps({
        specsFor: async () => many,
        startBackfill: async (_repo, specPath) => {
          started.push(specPath);

          return "run";
        },
      }),
    );

    expect(started).toHaveLength(BACKFILL_SPECS_PER_REPO);
  });

  it("says how many it held back, so a silent truncation cannot read as full coverage", async () => {
    const many = Array.from({ length: BACKFILL_SPECS_PER_REPO + 3 }, (_, i) =>
      `specs/s${i}/spec.md`,
    );

    const summary = await scanForBackfill(deps({ specsFor: async () => many }));

    expect(summary).toContain("3 held back");
  });

  it("keeps scanning the other repos when one cannot be listed", async () => {
    const started: string[] = [];

    const summary = await scanForBackfill(
      deps({
        repos: async () => ["o/bad", "o/good"],
        specsFor: async (repo) => {
          enforceTrue(repo !== "o/bad", Error, "chunks unavailable");

          return ["specs/a/spec.md"];
        },
        startBackfill: async (repo) => {
          started.push(repo);

          return "run";
        },
      }),
    );

    expect(started).toEqual(["o/good"]);
    expect(summary).toContain("1 repo failed");
  });

  it("reports nothing started when no repo has a spec to backfill", async () => {
    expect(await scanForBackfill(deps({ specsFor: async () => [] }))).toContain(
      "0 spec",
    );
  });
});
