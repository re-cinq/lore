import { describe, expect, it } from "vitest";
import { referencedSkillNames } from "./skill-references.js";

describe("referencedSkillNames", () => {
  it("returns tdd for a body naming the tdd skill", () => {
    expect(referencedSkillNames("Load the `tdd` skill first.")).toEqual([
      "tdd",
    ]);
  });

  it("returns testing for a body naming the testing skill possessively", () => {
    expect(referencedSkillNames("the `testing` skill's rules")).toEqual([
      "testing",
    ]);
  });

  it("returns both names from a Related line", () => {
    expect(
      referencedSkillNames("**Related:** `/tdd-loop`, `/testing`"),
    ).toEqual(["tdd-loop", "testing"]);
  });

  it("returns nothing for a slash path outside a Related line", () => {
    expect(referencedSkillNames("see src/a/b.ts and `vitest` runs")).toEqual(
      [],
    );
  });

  it("returns a name once when mentioned twice", () => {
    expect(
      referencedSkillNames("`testing` skill.\n**Related:** `/testing`"),
    ).toEqual(["testing"]);
  });
});
