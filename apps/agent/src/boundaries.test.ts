import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The agent is layered as a control plane; dependencies point INWARD only.
// Rank low→high: ports < data < adapters < application < delivery. A file in a
// layer may import its own layer, any lower layer, @re-cinq/lore-*, and npm —
// never a HIGHER layer (e.g. an adapter must not import application/, data must
// not import adapters/). Enforced as a test rather than an eslint stack.

const SRC = fileURLToPath(new URL(".", import.meta.url));
const RANK: Record<string, number> = {
  ports: 0,
  data: 1,
  adapters: 2,
  application: 3,
  delivery: 4,
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (e.endsWith(".ts") && !e.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function layerOf(abs: string): string {
  return path.relative(SRC, abs).split(path.sep)[0];
}

/** Relative import + dynamic-import specifiers in a source file. */
function relImports(src: string): string[] {
  const specs: string[] = [];
  for (const m of src.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) specs.push(m[1]);
  for (const m of src.matchAll(/import\(\s*["'](\.\.?\/[^"']+)["']/g)) specs.push(m[1]);
  return specs;
}

describe("agent layer boundaries", () => {
  const files = Object.keys(RANK)
    .map((l) => path.join(SRC, l))
    .filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap(tsFiles);

  it("has layered source to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports from a higher layer (dependencies point inward)", () => {
    const violations: string[] = [];
    for (const f of files) {
      const from = layerOf(f);
      for (const spec of relImports(readFileSync(f, "utf8"))) {
        const target = layerOf(path.resolve(path.dirname(f), spec));
        if (target in RANK && RANK[target] > RANK[from]) {
          violations.push(`${path.relative(SRC, f)} (${from}) → ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
