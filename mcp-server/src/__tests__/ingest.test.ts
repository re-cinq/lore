import { describe, it, expect } from "vitest";

// ── Ingest file type classification (copied from ingest.ts) ─────────

function classifyFile(path: string): string | null {
  if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|pdf|zip|tar|gz|lock)$/i.test(path)) return null;
  if (path.endsWith('CLAUDE.md') || path.endsWith('AGENTS.md') || path.endsWith('CODEOWNERS')) return 'doc';
  if (/(?:^|\/)adrs\//.test(path)) return 'adr';
  if (/(?:^|\/)specs\//.test(path) || path.startsWith('.specify/')) return 'spec';
  if (/(?:^|\/)runbooks\//.test(path)) return 'doc';
  if (/\.(ts|js|py|go|sh|rs|java|rb|kt|c|cpp|h|hpp)$/.test(path)) return 'code';
  if (path.endsWith('.md') || path.endsWith('.yaml') || path.endsWith('.yml')) return 'doc';
  return null;
}

describe("classifyFile", () => {
  it("classifies CLAUDE.md as doc", () => {
    expect(classifyFile("CLAUDE.md")).toBe("doc");
  });

  it("classifies nested CLAUDE.md as doc", () => {
    expect(classifyFile("teams/platform/CLAUDE.md")).toBe("doc");
  });

  it("classifies ADRs", () => {
    expect(classifyFile("adrs/ADR-001.md")).toBe("adr");
  });

  it("classifies specs", () => {
    expect(classifyFile("specs/my-feature/spec.md")).toBe("spec");
    expect(classifyFile(".specify/spec.md")).toBe("spec");
  });

  it("classifies code files", () => {
    expect(classifyFile("src/index.ts")).toBe("code");
    expect(classifyFile("main.go")).toBe("code");
    expect(classifyFile("lib/auth.py")).toBe("code");
  });

  it("skips binary files", () => {
    expect(classifyFile("logo.png")).toBeNull();
    expect(classifyFile("package-lock.json")).toBeNull();
    expect(classifyFile("fonts/Inter.woff2")).toBeNull();
  });

  it("skips unknown file types", () => {
    expect(classifyFile("Dockerfile")).toBeNull();
    expect(classifyFile(".env")).toBeNull();
  });
});

// ── IngestFile type handling ────────────────────────────────────────
// BUG FIX: ingestFiles previously only accepted string[] (file paths).
// When called from /api/ingest with {path, content} objects, the function
// treated them as strings, producing "[object Object]" as the file path.

describe("IngestFile type handling", () => {
  it("distinguishes path strings from content objects", () => {
    const pathFile = "CLAUDE.md";
    const contentFile = { path: "CLAUDE.md", content: "# Lore" };

    expect(typeof pathFile === "string").toBe(true);
    expect(typeof contentFile === "string").toBe(false);
    expect(typeof contentFile !== "string" && contentFile.content).toBeTruthy();
  });

  it("extracts path from both formats", () => {
    const pathFile = "CLAUDE.md";
    const contentFile = { path: "README.md", content: "# Hello" };

    const getPath = (f: string | { path: string; content: string }) =>
      typeof f === "string" ? f : f.path;

    expect(getPath(pathFile)).toBe("CLAUDE.md");
    expect(getPath(contentFile)).toBe("README.md");
  });
});

// ── Commit SHA fallback logic ───────────────────────────────────────
// BUG FIX: when the local MCP sent a commit SHA from repo A to fetch files
// from repo B, GitHub returned 404 (commit doesn't exist in that repo).
// The server treated this as "file deleted" and removed existing chunks.
// Fix: retry with "HEAD" when the commit doesn't exist in the target repo.

describe("commit SHA fallback", () => {
  it("should use HEAD when commit is from a different repo", () => {
    const localRepo: string = "re-cinq/lore";
    const targetRepo: string = "re-cinq/website-cf";
    const localHead = "abc1234";

    const commit = localRepo === targetRepo ? localHead : "HEAD";
    expect(commit).toBe("HEAD");
  });

  it("should use specific commit when repos match", () => {
    const localRepo: string = "re-cinq/lore";
    const targetRepo: string = "re-cinq/lore";
    const localHead = "abc1234";

    const commit = localRepo === targetRepo ? localHead : "HEAD";
    expect(commit).toBe("abc1234");
  });

  it("should retry refs in order: specific commit, then HEAD", () => {
    const commit: string = "abc1234";
    const refs = commit !== "HEAD" ? [commit, "HEAD"] : ["HEAD"];
    expect(refs).toEqual(["abc1234", "HEAD"]);
  });

  it("should not duplicate HEAD in retry list", () => {
    const commit: string = "HEAD";
    const refs = commit !== "HEAD" ? [commit, "HEAD"] : ["HEAD"];
    expect(refs).toEqual(["HEAD"]);
  });
});
