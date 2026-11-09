import { describe, expect, it } from "vitest";
import { decideScaffoldCommit } from "./onboard-scaffold.js";

describe("decideScaffoldCommit", () => {
  it("returns false for a lore-owned file when it matches canonical content", () => {
    expect(
      decideScaffoldCommit(
        { owner: "lore", content: "canonical" },
        "canonical",
      ),
    ).toBe(false);
  });

  it("returns true for a lore-owned file when it differs from canonical content", () => {
    expect(
      decideScaffoldCommit(
        { owner: "lore", content: "canonical" },
        "divergent content",
      ),
    ).toBe(true);
  });

  it("returns true for any file when it is absent", () => {
    expect(
      decideScaffoldCommit({ owner: "lore", content: "canonical" }, null),
    ).toBe(true);
  });

  it("returns false for a repo-owned file when it already exists", () => {
    expect(
      decideScaffoldCommit(
        { owner: "repo", content: "canonical" },
        "any content",
      ),
    ).toBe(false);
  });
});
