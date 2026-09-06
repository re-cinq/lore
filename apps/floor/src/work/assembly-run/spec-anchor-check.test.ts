import { describe, expect, it } from "vitest";
import { findRottenAnchors, rottenAnchorReport } from "./spec-anchor-check.js";

const lines =
  (files: Record<string, string[]>) =>
  (path: string): string[] | null =>
    files[path] ?? null;

describe("findRottenAnchors", () => {
  it("flags an anchor landing on a blank line", () => {
    expect(
      findRottenAnchors(
        [
          {
            path: "specs/app/spec.md",
            content: "A claim. ([validated by](../../tests/a.test.ts#L2))",
          },
        ],
        lines({ "tests/a.test.ts": ["it('x')", "   "] }),
      ),
    ).toEqual([
      {
        specPath: "specs/app/spec.md",
        target: "tests/a.test.ts",
        line: 2,
        reason: "blank line",
      },
    ]);
  });

  it("flags an anchor landing on a comment line in a .ts file", () => {
    expect(
      findRottenAnchors(
        [
          {
            path: "specs/app/spec.md",
            content: "A claim. ([validated by](../../tests/a.test.ts#L1))",
          },
        ],
        lines({ "tests/a.test.ts": ["// Behavioral: no spacer", "it('x')"] }),
      ),
    ).toEqual([
      {
        specPath: "specs/app/spec.md",
        target: "tests/a.test.ts",
        line: 1,
        reason: "comment line",
      },
    ]);
  });

  it("flags a # comment line in a workflow yml", () => {
    expect(
      findRottenAnchors(
        [
          {
            path: "specs/app/spec.md",
            content: "A claim. ([ci](../../.github/workflows/ci.yml#L1))",
          },
        ],
        lines({ ".github/workflows/ci.yml": ["# wraps the build", "run: x"] }),
      ),
    ).toEqual([
      {
        specPath: "specs/app/spec.md",
        target: ".github/workflows/ci.yml",
        line: 1,
        reason: "comment line",
      },
    ]);
  });

  it("flags a line past the end of the target file", () => {
    expect(
      findRottenAnchors(
        [
          {
            path: "specs/app/spec.md",
            content: "A claim. ([validated by](../../tests/a.test.ts#L9))",
          },
        ],
        lines({ "tests/a.test.ts": ["it('x')"] }),
      ),
    ).toEqual([
      {
        specPath: "specs/app/spec.md",
        target: "tests/a.test.ts",
        line: 9,
        reason: "line out of range",
      },
    ]);
  });

  it("flags a target file that does not exist on the branch", () => {
    expect(
      findRottenAnchors(
        [
          {
            path: "specs/app/spec.md",
            content: "A claim. ([validated by](../../tests/gone.test.ts#L1))",
          },
        ],
        lines({}),
      ),
    ).toEqual([
      {
        specPath: "specs/app/spec.md",
        target: "tests/gone.test.ts",
        line: 1,
        reason: "missing file",
      },
    ]);
  });

  it("accepts an anchor landing on a code line", () => {
    expect(
      findRottenAnchors(
        [
          {
            path: "specs/app/spec.md",
            content: "A claim. ([validated by](../../tests/a.test.ts#L1))",
          },
        ],
        lines({ "tests/a.test.ts": ["it('x', () => {})"] }),
      ),
    ).toEqual([]);
  });

  it("resolves a repo-root-relative anchor too — both styles occur in specs", () => {
    expect(
      findRottenAnchors(
        [
          {
            path: "specs/app/spec.md",
            content: "A claim. ([validated by](tests/a.test.ts#L2))",
          },
        ],
        lines({ "tests/a.test.ts": ["it('x')", ""] }),
      ),
    ).toEqual([
      {
        specPath: "specs/app/spec.md",
        target: "tests/a.test.ts",
        line: 2,
        reason: "blank line",
      },
    ]);
  });

  it("ignores external links", () => {
    expect(
      findRottenAnchors(
        [
          {
            path: "specs/app/spec.md",
            content: "See ([gh](https://github.com/re-cinq/lore#L5)).",
          },
        ],
        lines({}),
      ),
    ).toEqual([]);
  });
});

describe("rottenAnchorReport", () => {
  const repoOf = (files: Record<string, string>) => ({
    read: async (path: string, ref?: string) =>
      ref === "feat/x" ? (files[path] ?? null) : null,
  });

  it("reports rot found in the branch's changed markdown files", async () => {
    const body = await rottenAnchorReport({
      prNumber: 7,
      branch: "feat/x",
      pulls: { listFiles: async () => ["specs/app/spec.md", "src/a.ts"] },
      repo: repoOf({
        "specs/app/spec.md":
          "A claim. ([validated by](../../tests/a.test.ts#L2))",
        "tests/a.test.ts": "it('x')",
      }),
    });

    expect(body).toContain("tests/a.test.ts#L2");
    expect(body).toContain("line out of range");
  });

  it("returns null when every anchor in the changed specs resolves", async () => {
    expect(
      await rottenAnchorReport({
        prNumber: 7,
        branch: "feat/x",
        pulls: { listFiles: async () => ["specs/app/spec.md"] },
        repo: repoOf({
          "specs/app/spec.md":
            "A claim. ([validated by](../../tests/a.test.ts#L1))",
          "tests/a.test.ts": "it('x', () => {})",
        }),
      }),
    ).toBeNull();
  });

  it("returns null when the pull request changed no markdown", async () => {
    expect(
      await rottenAnchorReport({
        prNumber: 7,
        branch: "feat/x",
        pulls: { listFiles: async () => ["src/a.ts"] },
        repo: repoOf({}),
      }),
    ).toBeNull();
  });
});
