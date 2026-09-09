import { describe, it, expect } from "vitest";
import { parseUnifiedPatch, diffStats } from "./unified-diff";

const TWO_HUNKS = [
  "@@ -1,4 +1,4 @@",
  ' import { a } from "./a";',
  '-import { b } from "./b";',
  '+import { c } from "./c";',
  " ",
  " export function run() {",
  "@@ -20,3 +20,4 @@ export function run() {",
  "   return a();",
  " }",
  "+",
  "+export const VERSION = 2;",
].join("\n");

describe("parseUnifiedPatch", () => {
  it("numbers add, del and ctx lines from each hunk header across two hunks", () => {
    expect(parseUnifiedPatch(TWO_HUNKS)).toEqual([
      { kind: "hunk", oldNo: null, newNo: null, text: "@@ -1,4 +1,4 @@" },
      { kind: "ctx", oldNo: 1, newNo: 1, text: 'import { a } from "./a";' },
      { kind: "del", oldNo: 2, newNo: null, text: 'import { b } from "./b";' },
      { kind: "add", oldNo: null, newNo: 2, text: 'import { c } from "./c";' },
      { kind: "ctx", oldNo: 3, newNo: 3, text: "" },
      { kind: "ctx", oldNo: 4, newNo: 4, text: "export function run() {" },
      {
        kind: "hunk",
        oldNo: null,
        newNo: null,
        text: "@@ -20,3 +20,4 @@ export function run() {",
      },
      { kind: "ctx", oldNo: 20, newNo: 20, text: "  return a();" },
      { kind: "ctx", oldNo: 21, newNo: 21, text: "}" },
      { kind: "add", oldNo: null, newNo: 22, text: "" },
      {
        kind: "add",
        oldNo: null,
        newNo: 23,
        text: "export const VERSION = 2;",
      },
    ]);
  });

  it("numbers an added-only file from 1 when the hunk header omits the counts", () => {
    expect(parseUnifiedPatch("@@ -0,0 +1 @@\n+hello")).toEqual([
      { kind: "hunk", oldNo: null, newNo: null, text: "@@ -0,0 +1 @@" },
      { kind: "add", oldNo: null, newNo: 1, text: "hello" },
    ]);
  });

  it("keeps the no-newline marker as an unnumbered ctx line", () => {
    const patch = "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new";

    expect(parseUnifiedPatch(patch)).toEqual([
      { kind: "hunk", oldNo: null, newNo: null, text: "@@ -1 +1 @@" },
      { kind: "del", oldNo: 1, newNo: null, text: "old" },
      {
        kind: "ctx",
        oldNo: null,
        newNo: null,
        text: "\\ No newline at end of file",
      },
      { kind: "add", oldNo: null, newNo: 1, text: "new" },
    ]);
  });

  it("returns no lines for an empty, null or undefined patch", () => {
    expect(parseUnifiedPatch("")).toEqual([]);
    expect(parseUnifiedPatch(null)).toEqual([]);
    expect(parseUnifiedPatch(undefined)).toEqual([]);
  });
});

describe("diffStats", () => {
  it("counts 3 added and 1 removed over the two-hunk patch", () => {
    expect(diffStats(parseUnifiedPatch(TWO_HUNKS))).toEqual({
      added: 3,
      removed: 1,
    });
  });

  it("counts zero of each for no lines", () => {
    expect(diffStats([])).toEqual({ added: 0, removed: 0 });
  });
});
