import { describe, expect, it } from "vitest";
import {
  fileItem,
  floorRepoOf,
  gitItem,
  loreRepoOf,
  parseGitRef,
  parsePullRequestUrl,
  pullRequestUrl,
  valueItem,
} from "./floor-items.js";

describe("floor items", () => {
  it("spells re-cinq/Otto as github.com/re-cinq/otto", () => {
    expect(floorRepoOf("re-cinq/Otto")).toBe("github.com/re-cinq/otto");
  });

  it("reads github.com/re-cinq/lore back as re-cinq/lore", () => {
    expect(loreRepoOf("github.com/re-cinq/lore")).toBe("re-cinq/lore");
  });

  it("addresses pull request 412 of re-cinq/lore", () => {
    expect(pullRequestUrl("re-cinq/lore", 412)).toBe(
      "https://github.com/re-cinq/lore/pull/412",
    );
  });

  it("keeps the case of branch Fix/Login in a git item", () => {
    expect(gitItem("re-cinq/Lore", "Fix/Login")).toEqual({
      kind: "git",
      ref: "github.com/re-cinq/lore@Fix/Login",
      by: "lore",
    });
  });

  it("writes number 412 as the value 412", () => {
    expect(valueItem(412)).toEqual({ kind: "value", ref: "412", by: "lore" });
  });

  it("names blob abc123 as a file item", () => {
    expect(fileItem("abc123")).toEqual({
      kind: "file",
      ref: "abc123",
      by: "lore",
    });
  });

  it("reads re-cinq/lore and 412 from https://github.com/re-cinq/lore/pull/412", () => {
    expect(
      parsePullRequestUrl("https://github.com/re-cinq/lore/pull/412"),
    ).toEqual({ repo: "re-cinq/lore", prNumber: 412 });
  });

  it("reads number 7 from a pull request url ending with a slash", () => {
    expect(parsePullRequestUrl("https://github.com/a/b/pull/7/")).toEqual({
      repo: "a/b",
      prNumber: 7,
    });
  });

  it("refuses the issue url https://github.com/re-cinq/lore/issues/412", () => {
    expect(() =>
      parsePullRequestUrl("https://github.com/re-cinq/lore/issues/412"),
    ).toThrow(
      new Error(
        "not a GitHub pull request url: https://github.com/re-cinq/lore/issues/412",
      ),
    );
  });

  it("reads re-cinq/lore and Fix/Login back from github.com/re-cinq/lore@Fix/Login", () => {
    expect(parseGitRef("github.com/re-cinq/lore@Fix/Login")).toEqual({
      repo: "re-cinq/lore",
      branch: "Fix/Login",
    });
  });

  it("keeps the whole branch feature@v2, which git allows an at sign in", () => {
    expect(parseGitRef("github.com/re-cinq/lore@feature@v2")).toEqual({
      repo: "re-cinq/lore",
      branch: "feature@v2",
    });
  });

  it("refuses the ref github.com/re-cinq/lore, which names no branch", () => {
    expect(() => parseGitRef("github.com/re-cinq/lore")).toThrow(
      new Error("not a git ref: github.com/re-cinq/lore"),
    );
  });

  it("reads re-cinq/lore and spec/widget back from the clone url a station is handed, https://github.com/re-cinq/lore@spec/widget", () => {
    expect(parseGitRef("https://github.com/re-cinq/lore@spec/widget")).toEqual({
      repo: "re-cinq/lore",
      branch: "spec/widget",
    });
  });
});
