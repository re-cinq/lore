import { describe, expect, it } from "vitest";
import { absentNeedsReport, optionalNeed } from "./needs.js";

describe("the needs of a release station", () => {
  it("returns null when release_repo and release_version are both present", () => {
    expect(
      absentNeedsReport(
        { release_repo: "re-cinq/lore", release_version: "v1.3.0" },
        ["release_repo", "release_version"],
      ),
    ).toBe(null);
  });

  it("returns failed naming release_sha and release_notes when both are absent", () => {
    expect(
      absentNeedsReport({ release_repo: "re-cinq/lore" }, [
        "release_repo",
        "release_sha",
        "release_notes",
      ]),
    ).toEqual({
      outcome: "failed",
      error: "the run lacks release_sha, release_notes",
    });
  });

  it("returns the text of published_to when present and null when absent", () => {
    expect([
      optionalNeed({ published_to: "re-cinq/lore-public" }, "published_to"),
      optionalNeed({}, "published_to"),
    ]).toEqual(["re-cinq/lore-public", null]);
  });
});
