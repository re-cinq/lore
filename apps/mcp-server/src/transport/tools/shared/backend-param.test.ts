import { describe, it, expect } from "vitest";
import { backendNeedsApi, backendParam, readsUtopia } from "./backend-param.js";

describe("backendParam", () => {
  it("accepts an omitted backend and refuses one it does not know", () => {
    expect({
      omitted: backendParam.safeParse(undefined).success,
      lore: backendParam.safeParse("lore").success,
      unknown: backendParam.safeParse("elastic").success,
    }).toEqual({ omitted: true, lore: true, unknown: false });
  });
});

describe("readsUtopia", () => {
  it("is true for utopia and both, false for lore and an omitted backend", () => {
    expect({
      utopia: readsUtopia("utopia"),
      both: readsUtopia("both"),
      lore: readsUtopia("lore"),
      omitted: readsUtopia(undefined),
    }).toEqual({ utopia: true, both: true, lore: false, omitted: false });
  });
});

describe("backendNeedsApi", () => {
  it("names backend utopia as answered by the Lore API only", () => {
    expect(backendNeedsApi("utopia")).toBe(
      "backend utopia is answered by the Lore API only; set LORE_API_URL. The offline search reads Lore's stores alone.",
    );
  });
});
