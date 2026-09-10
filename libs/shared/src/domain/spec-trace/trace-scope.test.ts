import { describe, it, expect } from "vitest";
import {
  mainScope,
  overlayScope,
  overlayBranchOf,
  isOverlay,
  scopedXid,
  rootEdge,
} from "./trace-scope.js";

describe("mainScope", () => {
  it("keys on the bare repo and roots at Repo", () => {
    expect(mainScope("re-cinq/lore")).toEqual({
      repo: "re-cinq/lore",
      key: "re-cinq/lore",
      rootType: "Repo",
    });
  });

  it("returns false from isOverlay", () => {
    expect(isOverlay(mainScope("re-cinq/lore"))).toBe(false);
  });
});

describe("overlayScope", () => {
  it("inserts a branch segment between the repo and the path and roots at Overlay", () => {
    expect(overlayScope("re-cinq/lore", "lore/impl/issue-9")).toEqual({
      repo: "re-cinq/lore",
      key: "re-cinq/lore|branch:lore/impl/issue-9",
      rootType: "Overlay",
      branch: "lore/impl/issue-9",
    });
  });

  it("returns true from isOverlay", () => {
    expect(isOverlay(overlayScope("re-cinq/lore", "feat/x"))).toBe(true);
  });
});

describe("overlayBranchOf", () => {
  it("returns feat/x when the report names feat/x and the default branch is main", () => {
    expect(overlayBranchOf("feat/x", "main")).toBe("feat/x");
  });

  it("returns undefined when the report names the default branch", () => {
    expect(overlayBranchOf("trunk", "trunk")).toBeUndefined();
  });

  it("returns undefined for a detached HEAD", () => {
    expect(overlayBranchOf("HEAD", "main")).toBeUndefined();
  });

  it("returns undefined when the report names no branch", () => {
    expect(overlayBranchOf(undefined, "main")).toBeUndefined();
    expect(overlayBranchOf("", "main")).toBeUndefined();
  });
});

describe("scopedXid", () => {
  it("joins parts onto the main key with a pipe", () => {
    expect(scopedXid(mainScope("re-cinq/lore"), "src/a.ts")).toBe(
      "re-cinq/lore|src/a.ts",
    );
  });

  it("joins parts onto the overlay key so main and overlay never collide", () => {
    expect(scopedXid(overlayScope("re-cinq/lore", "feat/x"), "src/a.ts")).toBe(
      "re-cinq/lore|branch:feat/x|src/a.ts",
    );
  });

  it("joins several parts in order", () => {
    expect(scopedXid(mainScope("re-cinq/lore"), "a.test.ts", "renders")).toBe(
      "re-cinq/lore|a.test.ts|renders",
    );
  });
});

describe("rootEdge", () => {
  it("names the Repo predicate for a main scope", () => {
    expect(rootEdge(mainScope("re-cinq/lore"), "test_chunks")).toBe(
      "Repo.test_chunks",
    );
  });

  it("names the Overlay predicate for an overlay scope", () => {
    expect(
      rootEdge(overlayScope("re-cinq/lore", "feat/x"), "test_chunks"),
    ).toBe("Overlay.test_chunks");
  });
});
