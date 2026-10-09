import { describe, expect, it } from "vitest";
import { decideScaffoldCommit } from "./onboard-scaffold.js";

describe("decideScaffoldCommit", () => {
  it("returns false when current !== null and current !== file.content", () => {
    expect(
      decideScaffoldCommit(
        { owner: "lore", content: "canonical" },
        "divergent content",
      ),
    ).toBe(false);
  });
});
