import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));
const SELF = ["@re-cinq", "lore-shared"].join("/");

function tsFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
      continue;
    }

    if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }

  return out;
}

describe("shared package boundaries", () => {
  it("never imports itself by package name — the self-import resolves via the workspace symlink to dist locally but fails in CI, which runs src with no dist", () => {
    const offenders = tsFiles(SRC_DIR)
      .filter((f) => readFileSync(f, "utf8").includes(`"${SELF}`))
      .map((f) => path.relative(SRC_DIR, f));

    expect(offenders).toEqual([]);
  });
});
