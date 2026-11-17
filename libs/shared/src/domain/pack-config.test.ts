import { describe, expect, it } from "vitest";
import { packConfig } from "./pack-config.js";

describe("packConfig", () => {
  it("returns null when LORE_PACK_REPO is unset", () => {
    expect(packConfig({})).toBeNull();
  });

  it("returns the repo and ref when both are set", () => {
    expect(
      packConfig({ LORE_PACK_REPO: "acme/lore-pack", LORE_PACK_REF: "prod" }),
    ).toEqual({ repo: "acme/lore-pack", ref: "prod" });
  });

  it("returns an undefined ref when LORE_PACK_REF is empty", () => {
    expect(
      packConfig({ LORE_PACK_REPO: "acme/lore-pack", LORE_PACK_REF: "" }),
    ).toEqual({ repo: "acme/lore-pack", ref: undefined });
  });
});
