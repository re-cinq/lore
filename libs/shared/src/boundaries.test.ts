import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// A package must not import itself by name.
//
// `@re-cinq/lore-shared` from INSIDE libs/shared resolves through the workspace
// symlink to this package's own `dist/` — so it works on a machine that has
// built, and fails in CI, which runs vitest against `src/` with no dist. Three
// files moved into this package carried that import with them and turned the
// `shared` job red while every local run stayed green.
//
// Relative imports have neither problem: they resolve to the source next door,
// build or no build.
//
// A test rather than an eslint rule to match `libs/assembly-lines`'s existing
// boundaries check, which guards the mirror-image invariant.

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));
// Composed rather than written out, so this file is not itself an offender.
const SELF = ["@re-cinq", "lore-shared"].join("/");

function tsFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }

  return out;
}

describe("shared package boundaries", () => {
  it("never imports itself by package name, in sources or tests", () => {
    const offenders = tsFiles(SRC_DIR)
      .filter((f) => readFileSync(f, "utf8").includes(`"${SELF}`))
      .map((f) => path.relative(SRC_DIR, f));

    expect(offenders).toEqual([]);
  });
});
