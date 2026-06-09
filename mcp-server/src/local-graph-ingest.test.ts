import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localTreeFromFs } from "./local-graph-ingest.js";

describe("localTreeFromFs", () => {
  it("lists markdown recursively as repo-relative posix paths, skipping .git/node_modules and non-markdown", () => {
    const root = mkdtempSync(join(tmpdir(), "lgi-"));
    try {
      mkdirSync(join(root, "specs", "auth"), { recursive: true });
      mkdirSync(join(root, "node_modules", "x"), { recursive: true });
      mkdirSync(join(root, ".git"), { recursive: true });
      writeFileSync(join(root, "specs", "auth", "spec.md"), "x");
      writeFileSync(join(root, "README.md"), "x");
      writeFileSync(join(root, "src.ts"), "x");
      writeFileSync(join(root, "ui.tsx"), "x");
      writeFileSync(join(root, "notes.txt"), "x");
      writeFileSync(join(root, "node_modules", "x", "dep.md"), "x");
      writeFileSync(join(root, ".git", "config.md"), "x");

      expect(localTreeFromFs(root).sort()).toEqual(["README.md", "specs/auth/spec.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
