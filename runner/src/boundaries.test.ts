import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The runner is a portable, dependency-lean execution kernel. Two invariants
// keep it that way (and let Phase 3 bundle it to a small static binary):
//   1. it never imports the agent (it must run without the coordinator), and
//   2. it imports @re-cinq/lore-shared only via narrow subpaths, never the
//      barrel — the barrel pulls heavy deps (dgraph, tree-sitter, the SDK).
// Enforced as a test rather than an eslint stack the repo doesn't otherwise use.

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

// Production kernel sources only — the invariant is about the shipped/bundled
// code, not test helpers (which never end up in the static binary).
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const files = tsFiles(SRC_DIR);
const rel = (f: string): string => path.relative(SRC_DIR, f);

function offenders(pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(readFileSync(f, "utf8"))).map(rel);
}

describe("runner package boundaries", () => {
  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports the agent package", () => {
    expect(offenders(/from\s+["']@re-cinq\/lore-agent/)).toEqual([]);
  });

  it("imports @re-cinq/lore-shared only via subpaths, never the barrel", () => {
    // Matches a bare-barrel specifier: `@re-cinq/lore-shared` with no `/...`
    // after it. Subpath imports (`@re-cinq/lore-shared/commit-trailers.js`) pass.
    expect(offenders(/from\s+["']@re-cinq\/lore-shared["']/)).toEqual([]);
  });
});
