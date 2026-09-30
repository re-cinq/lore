import { describe, it, expect } from "vitest";
import {
  allPathsMatch,
  matchingPatterns,
  pathsMatching,
} from "./path-match.js";

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
    expect(allPathsMatch(["nested/subdir/file.md"], ["*.md"])).toBe(false);
  });

  it("matches deeply nested paths under specs/**", () => {
    expect(
      allPathsMatch(["specs/6-dark-factory/contracts/x.md"], ["specs/**"]),
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

describe("pathsMatching", () => {
  it("returns the changed paths that match any glob, in changed-path order", () => {
    expect(
      pathsMatching(
        ["apps/api/src/server.ts", "README.md", "infra/main.tf"],
        ["infra/**", "apps/api/src/server.ts"],
      ),
    ).toEqual(["apps/api/src/server.ts", "infra/main.tf"]);
  });

  it("matches a root CLAUDE.md and a nested .claude directory against **/ globs", () => {
    expect(
      pathsMatching(
        ["CLAUDE.md", "apps/web/.claude/settings.json"],
        ["**/CLAUDE.md", "**/.claude/**"],
      ),
    ).toEqual(["CLAUDE.md", "apps/web/.claude/settings.json"]);
  });

  it("returns an empty list when no glob is given", () => {
    expect(pathsMatching(["infra/main.tf"], [])).toEqual([]);
  });
});
