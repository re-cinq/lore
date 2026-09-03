import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL(".", import.meta.url));

const DEAD_LAYERS = ["adapters", "application", "data", "ports"];

function tsFiles(dir: string): string[] {
  const out: string[] = [];

  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);

    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
      continue;
    }

    if (e.endsWith(".ts")) {
      out.push(full);
    }
  }

  return out;
}

function relImports(src: string): string[] {
  const specs: string[] = [];

  for (const m of src.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
    specs.push(m[1]);
  }

  for (const m of src.matchAll(/import\(\s*["'](\.\.?\/[^"']+)["']/g)) {
    specs.push(m[1]);
  }

  for (const m of src.matchAll(
    /vi\.(?:mock|doMock)\(\s*["'](\.\.?\/[^"']+)["']/g,
  )) {
    specs.push(m[1]);
  }

  return specs;
}

function domainOf(abs: string): string {
  return path.relative(SRC, abs).split(path.sep)[0];
}

const files = tsFiles(SRC);

function offendingImports(
  sources: string[],
  offense: (file: string, spec: string) => string | null,
): string[] {
  return sources.flatMap((file) =>
    relImports(readFileSync(file, "utf8")).flatMap(
      (spec) => offense(file, spec) ?? [],
    ),
  );
}

describe("floor domain boundaries", () => {
  it("has source to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports a dissolved horizontal layer (adapters/application/data/ports)", () => {
    const bad = offendingImports(files, (f, spec) => {
      const target = domainOf(path.resolve(path.dirname(f), spec));

      return DEAD_LAYERS.includes(target)
        ? `${path.relative(SRC, f)} → ${spec}`
        : null;
    });

    expect(bad).toEqual([]);
  });

  it("kernel/ imports nothing outside kernel/ (it is the shared substrate)", () => {
    const bad = offendingImports(
      files.filter((f) => domainOf(f) === "kernel"),
      (f, spec) => {
        const target = domainOf(path.resolve(path.dirname(f), spec));

        return target !== "kernel"
          ? `${path.relative(SRC, f)} → ${spec} (${target})`
          : null;
      },
    );

    expect(bad).toEqual([]);
  });

  it("delivery/ is a top entry-point tier — nothing imports it except the root entry", () => {
    const exempt = (f: string) =>
      domainOf(f) === "delivery" || path.relative(SRC, f) === "index.ts";
    const bad = offendingImports(
      files.filter((f) => !exempt(f)),
      (f, spec) => {
        const target = domainOf(path.resolve(path.dirname(f), spec));

        return target === "delivery"
          ? `${path.relative(SRC, f)} → ${spec}`
          : null;
      },
    );

    expect(bad).toEqual([]);
  });

  const libPrefix = path.join(SRC, "jobs", "lib") + path.sep;

  it("jobs/lib/ is a leaf — imports only kernel/ and shared, never a sibling job domain", () => {
    const bad = offendingImports(
      files.filter((f) => f.startsWith(libPrefix)),
      (f, spec) => {
        const rel = path
          .relative(SRC, path.resolve(path.dirname(f), spec))
          .split(path.sep);
        const withinLib = rel[0] === "jobs" && rel[1] === "lib";

        return rel[0] !== "kernel" && !withinLib
          ? `${path.relative(SRC, f)} → ${spec} (${rel.slice(0, 2).join("/")})`
          : null;
      },
    );

    expect(bad).toEqual([]);
  });
});
