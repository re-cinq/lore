import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const srcDir = dirname(fileURLToPath(import.meta.url));

describe("public barrel (index.ts)", () => {
  it("re-exports every non-test, non-declaration module in src/, vacuously passing when run against the .ts-less compiled dist/", () => {
    const indexPath = join(srcDir, "index.ts");

    if (!existsSync(indexPath)) {
      return;
    }
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
