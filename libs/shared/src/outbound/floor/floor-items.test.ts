import { describe, expect, it } from "vitest";
import {
  fileItem,
  floorRepoOf,
  gitItem,
  loreRepoOf,
  pullRequestSubject,
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

  it("keys a review run on pr_url and the pull request address", () => {
    expect(pullRequestSubject("re-cinq/lore", 412)).toBe(
      "pr_url:https://github.com/re-cinq/lore/pull/412",
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
});
