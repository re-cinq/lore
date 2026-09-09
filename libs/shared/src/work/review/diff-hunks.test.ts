import { describe, it, expect } from "vitest";
import { commentablePositions, isCommentable } from "./diff-hunks.js";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@ function f() {",
  " const x = 1;",
  "-  return x;",
  "+  const y = 2;",
  "+  return x + y;",
  " }",
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+export const z = 3;",
  "+export const w = 4;",
].join("\n");

describe("commentablePositions", () => {
  it("marks added and context lines commentable on the right (new) side", () => {
    const pos = commentablePositions(diff);

    expect(
      [...(pos.right.get("src/a.ts") ?? [])].sort((a, b) => a - b),
    ).toEqual([10, 11, 12, 13]);
    expect(
      [...(pos.right.get("src/new.ts") ?? [])].sort((a, b) => a - b),
    ).toEqual([1, 2]);
  });

  it("marks removed and context lines commentable on the left (old) side", () => {
    const pos = commentablePositions(diff);

    expect([...(pos.left.get("src/a.ts") ?? [])].sort((a, b) => a - b)).toEqual(
      [10, 11, 12],
    );
    expect(pos.left.has("src/new.ts")).toBe(false);
  });
});

describe("isCommentable", () => {
  const pos = commentablePositions(diff);

  it("is true for a line inside a hunk", () => {
    expect(isCommentable(pos, "src/a.ts", 11)).toBe(true);
  });

  it("is false for a line outside any hunk", () => {
    expect(isCommentable(pos, "src/a.ts", 82)).toBe(false);
  });

  it("is false for a file not in the diff", () => {
    expect(isCommentable(pos, "CLAUDE.md", 1)).toBe(false);
  });

  it("checks the left side for a LEFT-side comment", () => {
    expect(isCommentable(pos, "src/a.ts", 11, "LEFT")).toBe(true);
    expect(isCommentable(pos, "src/a.ts", 11, "RIGHT")).toBe(true);
  });
});

describe("commentablePositions on a deleted file", () => {
  const deleted = [
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-const a = 1;",
    "-const b = 2;",
  ].join("\n");

  it("tracks no positions — a +++ /dev/null target is uncommentable on either side", () => {
    const pos = commentablePositions(deleted);

    expect(pos.right.has("gone.ts")).toBe(false);
    expect(pos.left.has("gone.ts")).toBe(false);
  });
});
