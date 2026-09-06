import { describe, it, expect } from "vitest";
import { parseAdrRefs, adrNumberFromPath } from "./adr-refs.js";

describe("parseAdrRefs", () => {
  it("extracts distinct ADR numbers, normalizing zero-padding", () => {
    expect(
      parseAdrRefs("Builds on ADR-016 and see ADR-7; per ADR-016 again."),
    ).toEqual([16, 7]);
  });
  it("returns nothing when no ADR is cited", () => {
    expect(
      parseAdrRefs("A plain statement with no decision reference."),
    ).toEqual([]);
  });
  it("matches an ADR cited with a slug suffix", () => {
    expect(parseAdrRefs("per ADR-016-dark-factory-mode")).toEqual([16]);
  });
});

describe("adrNumberFromPath", () => {
  it("extracts the number from an ADR filename", () => {
    expect(adrNumberFromPath("adrs/ADR-016-dark-factory.md")).toBe(16);
    expect(adrNumberFromPath("adrs/ADR-7-foo.md")).toBe(7);
  });
  it("returns null for a non-ADR path", () => {
    expect(adrNumberFromPath("specs/auth/spec.md")).toBeNull();
  });
});
