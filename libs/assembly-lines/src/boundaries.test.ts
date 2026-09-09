import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
      continue;
    }

    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
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

  it("never imports the floor app package", () => {
    expect(offenders(/from\s+["']@re-cinq\/lore-floor/)).toEqual([]);
  });

  it("imports @re-cinq/lore-shared only via subpaths (e.g. commit-trailers.js), never the bare-barrel specifier", () => {
    expect(offenders(/from\s+["']@re-cinq\/lore-shared["']/)).toEqual([]);
  });
});
