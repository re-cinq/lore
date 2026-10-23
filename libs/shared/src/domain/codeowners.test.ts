import { describe, it, expect } from "vitest";
import {
  codeownersOf,
  ownedPaths,
  ownersOfPath,
  parseCodeowners,
} from "./codeowners.js";

const owners = (text: string, paths: string[]) =>
  Object.fromEntries(
    paths.map((path) => [path, ownersOfPath(path, parseCodeowners(text))]),
  );

describe("parseCodeowners", () => {
  it("reads one row per pattern line, skipping comments and blank lines", () => {
    expect(
      parseCodeowners("# owners\n\n* @alice @bob\ndocs/** @writer # docs\n"),
    ).toEqual([
      { pattern: "*", owners: ["@alice", "@bob"] },
      { pattern: "docs/**", owners: ["@writer"] },
    ]);
  });
});

describe("ownersOfPath", () => {
  it("gives the last matching row's owners, root CLAUDE.md to @alice after * @bob", () => {
    expect(
      owners("* @bob\n/CLAUDE.md @alice\n", ["CLAUDE.md", "src/a.ts"]),
    ).toEqual({ "CLAUDE.md": ["@alice"], "src/a.ts": ["@bob"] });
  });

  it("gives .github/ to @ops for every file under .github at any depth and nothing else", () => {
    expect(
      owners(".github/ @ops\n", [
        ".github/workflows/ci.yml",
        "apps/web/.github/CODEOWNERS",
        "github/notes.md",
        "CLAUDE.md",
      ]),
    ).toEqual({
      ".github/workflows/ci.yml": ["@ops"],
      "apps/web/.github/CODEOWNERS": ["@ops"],
      "github/notes.md": [],
      "CLAUDE.md": [],
    });
  });

  it("gives /adrs/ and docs/adrs/ only to files under that directory at the root", () => {
    expect(
      owners("/adrs/ @arch\ndocs/adrs/ @writer\n", [
        "adrs/ADR-001.md",
        "libs/adrs/ADR-002.md",
        "docs/adrs/ADR-003.md",
        "apps/docs/adrs/ADR-004.md",
      ]),
    ).toEqual({
      "adrs/ADR-001.md": ["@arch"],
      "libs/adrs/ADR-002.md": [],
      "docs/adrs/ADR-003.md": ["@writer"],
      "apps/docs/adrs/ADR-004.md": [],
    });
  });
});

describe("codeownersOf", () => {
  it("reads the first CODEOWNERS present, .github/ before the root, and none when there is none", async () => {
    const files: Record<string, string> = {
      ".github/CODEOWNERS": "/.github/ @re-cinq/platform",
      CODEOWNERS: "* @someone",
    };
    const read = async (path: string) => files[path] ?? null;

    expect([
      await codeownersOf({ read }),
      await codeownersOf({ read: async () => null }),
    ]).toEqual([[{ pattern: "/.github/", owners: ["@re-cinq/platform"] }], []]);
  });
});

describe("ownedPaths", () => {
  it("keeps .github/workflows/ci.yml, which /.github/ owns, and drops src/a.ts", () => {
    expect(
      ownedPaths(
        [".github/workflows/ci.yml", "src/a.ts"],
        [{ pattern: "/.github/", owners: ["@re-cinq/platform"] }],
      ),
    ).toEqual([".github/workflows/ci.yml"]);
  });
});
