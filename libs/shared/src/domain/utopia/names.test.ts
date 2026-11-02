import { describe, it, expect } from "vitest";
import { markdownFilename, slug } from "./names.js";

describe("slug", () => {
  it("lower-cases Fix: the Build (#12)! as fix-the-build-12 and cuts a 80-letter title to 60 characters", () => {
    expect([
      slug("Fix: the Build (#12)!"),
      slug("a".repeat(80)).length,
    ]).toEqual(["fix-the-build-12", 60]);
  });

  it("ends a title cut inside a word break without a dash", () => {
    expect(slug(`${"a".repeat(59)} b`)).toEqual("a".repeat(59));
  });
});

describe("markdownFilename", () => {
  it("joins pr-7 and Add a thing as pr-7-add-a-thing.md and keeps the id alone when the title has no letters", () => {
    expect([
      markdownFilename("pr-7", "Add a thing"),
      markdownFilename("pr-7", "!!!"),
    ]).toEqual(["pr-7-add-a-thing.md", "pr-7.md"]);
  });
});
