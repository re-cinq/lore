import { describe, it, expect } from "vitest";
import { allPathsMatch, matchingPatterns } from "../lib/path-match.js";

const DEFAULT_ALLOWLIST = [
  "specs/**",
  "adrs/**",
  "*.md",
  "CLAUDE.md",
  ".claude/**",
];

describe("allPathsMatch", () => {
  it("returns true when every path matches some pattern", () => {
    expect(
      allPathsMatch(
        ["specs/foo/spec.md", "adrs/ADR-001.md", "CLAUDE.md", "README.md"],
        DEFAULT_ALLOWLIST,
      ),
    ).toBe(true);
  });

  it("returns false on a single non-matching path (mixed PR)", () => {
    expect(
      allPathsMatch(
        ["specs/foo/spec.md", "agent/src/foo.ts"],
        DEFAULT_ALLOWLIST,
      ),
    ).toBe(false);
  });

  it("returns false for purely non-matching paths", () => {
    expect(
      allPathsMatch(
        ["agent/src/foo.ts", "mcp-server/src/bar.ts"],
        DEFAULT_ALLOWLIST,
      ),
    ).toBe(false);
  });

  it("returns true for empty changed paths (vacuous)", () => {
    expect(allPathsMatch([], DEFAULT_ALLOWLIST)).toBe(true);
  });

  it("returns false for empty allowlist", () => {
    expect(allPathsMatch(["specs/foo.md"], [])).toBe(false);
  });

  it("matches dotfiles like .claude/rules/", () => {
    expect(
      allPathsMatch([".claude/rules/security.md"], DEFAULT_ALLOWLIST),
    ).toBe(true);
  });

  it("does not match nested paths against a top-level *.md", () => {
    // *.md should match top-level only, not nested.
    expect(
      allPathsMatch(
        ["nested/subdir/file.md"],
        ["*.md"],
      ),
    ).toBe(false);
  });

  it("matches deeply nested paths under specs/**", () => {
    expect(
      allPathsMatch(
        ["specs/6-dark-factory/contracts/x.md"],
        ["specs/**"],
      ),
    ).toBe(true);
  });
});

describe("matchingPatterns", () => {
  it("lists every pattern that matches a path", () => {
    expect(matchingPatterns("CLAUDE.md", DEFAULT_ALLOWLIST).sort()).toEqual([
      "*.md",
      "CLAUDE.md",
    ]);
  });

  it("returns empty for non-matching path", () => {
    expect(matchingPatterns("agent/src/foo.ts", DEFAULT_ALLOWLIST)).toEqual([]);
  });
});
