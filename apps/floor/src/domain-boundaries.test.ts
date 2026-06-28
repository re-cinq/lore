import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Floor is sliced VERTICALLY: each top-level folder under src/ is a domain that
// owns its port + implementation + orchestration + colocated tests. Two folders
// are special: `kernel/` is the shared substrate (DB pool, config, repositories,
// the CodePlatform port) every domain may import and that imports nothing above
// it; `delivery/` is the entry-point tier (the deploy contract `dist/delivery/*`)
// that sits at the top and is imported by nothing. `composition/` wires impls.
// Enforced as a test rather than an eslint stack (replaces the old layer-rank
// boundaries.test.ts).

const SRC = fileURLToPath(new URL(".", import.meta.url));

/** Dissolved horizontal layers — no import may resolve into one again. */
const DEAD_LAYERS = ["adapters", "application", "data", "ports"];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (e.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Relative import + dynamic-import + vi.mock specifiers in a source file. */
function relImports(src: string): string[] {
  const specs: string[] = [];
  for (const m of src.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) specs.push(m[1]);
  for (const m of src.matchAll(/import\(\s*["'](\.\.?\/[^"']+)["']/g)) specs.push(m[1]);
  for (const m of src.matchAll(/vi\.(?:mock|doMock)\(\s*["'](\.\.?\/[^"']+)["']/g)) specs.push(m[1]);
  return specs;
}

/** Top-level domain folder a file (or a resolved import target) belongs to. */
function domainOf(abs: string): string {
  return path.relative(SRC, abs).split(path.sep)[0];
}

const files = tsFiles(SRC);

describe("floor domain boundaries", () => {
  it("has source to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports a dissolved horizontal layer (adapters/application/data/ports)", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const spec of relImports(readFileSync(f, "utf8"))) {
        const target = domainOf(path.resolve(path.dirname(f), spec));
        if (DEAD_LAYERS.includes(target)) bad.push(`${path.relative(SRC, f)} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("kernel/ imports nothing outside kernel/ (it is the shared substrate)", () => {
    const bad: string[] = [];
    for (const f of files.filter((f) => domainOf(f) === "kernel")) {
      for (const spec of relImports(readFileSync(f, "utf8"))) {
        const target = domainOf(path.resolve(path.dirname(f), spec));
        if (target !== "kernel") bad.push(`${path.relative(SRC, f)} → ${spec} (${target})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("delivery/ is the top entry-point tier — nothing else imports it", () => {
    const bad: string[] = [];
    for (const f of files.filter((f) => domainOf(f) !== "delivery")) {
      for (const spec of relImports(readFileSync(f, "utf8"))) {
        const target = domainOf(path.resolve(path.dirname(f), spec));
        if (target === "delivery") bad.push(`${path.relative(SRC, f)} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
