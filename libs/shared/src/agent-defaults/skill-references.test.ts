import { describe, expect, it } from "vitest";
import {
  referencedMarkdownFiles,
  referencedSkillNames,
} from "./skill-references.js";

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

describe("referencedMarkdownFiles", () => {
  it("returns event-store.md for a backticked bare file name", () => {
    expect(referencedMarkdownFiles("see `event-store.md` for more")).toEqual([
      "event-store.md",
    ]);
  });

  it("returns resources/msw.md with its folder when the path is backticked", () => {
    expect(referencedMarkdownFiles("load `resources/msw.md`")).toEqual([
      "resources/msw.md",
    ]);
  });

  it("returns a file once when mentioned twice", () => {
    expect(referencedMarkdownFiles("`a.md` then `a.md`")).toEqual(["a.md"]);
  });

  it("returns nothing for prose that is not a backticked markdown file", () => {
    expect(referencedMarkdownFiles("a.md and `vitest` and `x.ts`")).toEqual([]);
  });
});
