import { describe, it, expect } from "vitest";
import {
  blobUrl,
  githubPage,
  markdownFilename,
  personName,
  slug,
} from "./names.js";

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

describe("names on host ghe.example.com", () => {
  it("names the default branch tree https://ghe.example.com/o/r/blob/HEAD", () => {
    expect(blobUrl("o/r", "ghe.example.com")).toBe(
      "https://ghe.example.com/o/r/blob/HEAD",
    );
  });

  it("names a page https://ghe.example.com/o/r/pull/7", () => {
    expect(githubPage("o/r/pull/7", "ghe.example.com")).toBe(
      "https://ghe.example.com/o/r/pull/7",
    );
  });

  it("names the person ghe.example.com/octocat", () => {
    expect(personName("octocat", "ghe.example.com")).toBe(
      "ghe.example.com/octocat",
    );
  });
});
