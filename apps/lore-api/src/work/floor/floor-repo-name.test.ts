import { describe, expect, it } from "vitest";
import { withoutHostPrefix } from "./floor-repo-name.js";

describe("withoutHostPrefix", () => {
  it("returns re-cinq/lore for github.com/re-cinq/lore", () => {
    expect(withoutHostPrefix("github.com/re-cinq/lore")).toBe("re-cinq/lore");
  });

  it("returns re-cinq/lore for ghe.example.com/re-cinq/lore on host ghe.example.com", () => {
    expect(
      withoutHostPrefix("ghe.example.com/re-cinq/lore", "ghe.example.com"),
    ).toBe("re-cinq/lore");
  });

  it("keeps github.com/re-cinq/lore on host ghe.example.com", () => {
    expect(
      withoutHostPrefix("github.com/re-cinq/lore", "ghe.example.com"),
    ).toBe("github.com/re-cinq/lore");
  });
});
