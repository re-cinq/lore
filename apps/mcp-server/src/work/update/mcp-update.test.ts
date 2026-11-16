import { describe, it, expect } from "vitest";
import { deriveUpdateStatus } from "./mcp-update.js";

const BUILT = "aaaaaaa1111111111111111111111111111111111";

describe("deriveUpdateStatus", () => {
  it("offers an update with 3 commits when the deployed build is 3 commits ahead of the adapter", () => {
    expect(deriveUpdateStatus(BUILT, "bbbbbbb", "behind", 3)).toEqual({
      updateAvailable: true,
      commitsBehind: 3,
      builtSha: BUILT,
      latestSha: "bbbbbbb",
    });
  });

  it("offers an update with no count when the checkout lacks the deployed commit", () => {
    expect(deriveUpdateStatus(BUILT, "bbbbbbb", "unknown", null)).toEqual({
      updateAvailable: true,
      commitsBehind: null,
      builtSha: BUILT,
      latestSha: "bbbbbbb",
    });
  });

  it("offers nothing when the adapter was built from the deployed short sha", () => {
    expect(
      deriveUpdateStatus(BUILT, "aaaaaaa", "unknown", null).updateAvailable,
    ).toBe(false);
  });

  it("offers nothing when the adapter is ahead of the deployed build", () => {
    expect(
      deriveUpdateStatus(BUILT, "bbbbbbb", "ahead", null).updateAvailable,
    ).toBe(false);
  });

  it("offers nothing when lore-api could not name the deployed build", () => {
    expect(deriveUpdateStatus(BUILT, null, "unknown", null)).toEqual({
      updateAvailable: false,
      commitsBehind: null,
      builtSha: BUILT,
      latestSha: null,
    });
  });
});
