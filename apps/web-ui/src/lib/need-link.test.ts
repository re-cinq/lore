import { describe, it, expect } from "vitest";
import { commitLink, needLink } from "./need-link";

const HASH = `sha256-${"ab12".repeat(16)}`;

describe("needLink", () => {
  it("links github.com/re-cinq/lore@fix/login to that branch on GitHub", () => {
    expect(needLink("github.com/re-cinq/lore@fix/login", "run-1")).toEqual({
      href: "https://github.com/re-cinq/lore/tree/fix/login",
      external: true,
    });
  });

  it("links github.com/re-cinq/lore without a branch to the repository", () => {
    expect(needLink("github.com/re-cinq/lore", "run-1")).toEqual({
      href: "https://github.com/re-cinq/lore",
      external: true,
    });
  });

  it("encodes a branch with a space and a hash sign segment by segment", () => {
    expect(needLink("github.com/re-cinq/lore@feat/a b#1", "run-1")).toEqual({
      href: "https://github.com/re-cinq/lore/tree/feat/a%20b%231",
      external: true,
    });
  });

  it("links a pull request URL to itself", () => {
    expect(
      needLink("https://github.com/re-cinq/lore/pull/412", "run-1"),
    ).toEqual({
      href: "https://github.com/re-cinq/lore/pull/412",
      external: true,
    });
  });

  it("links a sha256 blob hash to the run's blob page", () => {
    expect(needLink(HASH, "run-1")).toEqual({
      href: `/assembly-runs/run-1/blobs/${HASH}`,
      external: false,
    });
  });

  it("leaves a plain value such as task-1 unlinked", () => {
    expect(needLink("task-1", "run-1")).toBeNull();
  });

  it("leaves a git ref on a host it does not know unlinked", () => {
    expect(needLink("git.example.com/o/r@main", "run-1")).toBeNull();
  });

  it("leaves a javascript: URL unlinked", () => {
    expect(needLink("javascript:alert(1)", "run-1")).toBeNull();
  });

  it("leaves text that merely contains a URL unlinked", () => {
    expect(needLink("see https://github.com/re-cinq/lore", "run-1")).toBeNull();
  });
});

describe("commitLink", () => {
  it("links github.com/re-cinq/lore@fix/login at abc1234 to that commit", () => {
    expect(commitLink("github.com/re-cinq/lore@fix/login", "abc1234")).toBe(
      "https://github.com/re-cinq/lore/commit/abc1234",
    );
  });

  it("links nothing for a git ref with no sha", () => {
    expect(
      commitLink("github.com/re-cinq/lore@fix/login", undefined),
    ).toBeNull();
  });

  it("links nothing for a ref on a host it does not know", () => {
    expect(commitLink("gitlab.com/re-cinq/lore@main", "abc1234")).toBeNull();
  });
});
