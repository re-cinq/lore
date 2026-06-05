import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Lint-as-test for the public barrel: every non-test module under `src/`
 * must be re-exported from `index.ts`. Catches the recurring "added a
 * module, forgot the barrel line" friction at test time instead of at the
 * importing package's build. (Excludes `.d.ts` so the compiled `dist/` glob
 * run — which has no `.ts` sources — passes vacuously.)
 */
const srcDir = dirname(fileURLToPath(import.meta.url));

describe("public barrel (index.ts)", () => {
  it("re-exports every non-test module in src/", () => {
    const indexPath = join(srcDir, "index.ts");
    // The compiled dist/ glob run has no .ts sources — nothing to lint there.
    if (!existsSync(indexPath)) return;
    const index = readFileSync(indexPath, "utf8");
    const modules = readdirSync(srcDir)
      .filter(
        (f) =>
          f.endsWith(".ts") &&
          !f.endsWith(".test.ts") &&
          !f.endsWith(".d.ts") &&
          f !== "index.ts",
      )
      .map((f) => f.replace(/\.ts$/, ""));

    const missing = modules.filter((m) => !index.includes(`./${m}.js`));
    expect(missing).toEqual([]);
  });
});
