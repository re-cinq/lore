import { describe, expect, it } from "vitest";
import { repoFavicon } from "./repo-favicon";

describe("repoFavicon", () => {
  it("returns RL initials and a stable hex background for re-cinq/lore", () => {
    const firstBadge = repoFavicon("re-cinq", "lore");
    const secondBadge = repoFavicon("re-cinq", "lore");

    expect(firstBadge).toEqual({
      initials: "RL",
      backgroundColor: expect.stringMatching(/^#[0-9A-F]{6}$/),
    });
    expect(secondBadge).toEqual(firstBadge);
  });

  it("returns empty initials for an empty owner and repo", () => {
    expect(repoFavicon("", "")).toMatchObject({ initials: "" });
  });
});
