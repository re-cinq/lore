import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const srcDir = import.meta.dirname;

function collectModules(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return collectModules(join(dir, entry.name), `${prefix}${entry.name}/`);
    }
    const f = entry.name;

    if (
      !f.endsWith(".ts") ||
      f.endsWith(".test.ts") ||
      f.endsWith(".d.ts") ||
      f === "index.ts"
    )
      {return [];}

    return [`${prefix}${f.replace(/\.ts$/, "")}`];
  });
}

describe("public barrel (index.ts)", () => {
  it("re-exports every non-test, non-declaration module in src/, vacuously passing when run against the .ts-less compiled dist/", () => {
    const indexPath = join(srcDir, "index.ts");

    if (!existsSync(indexPath)) {
      return;
    }
    const index = readFileSync(indexPath, "utf8");
    const modules = collectModules(srcDir);

    const missing = modules.filter((m) => {
      if (index.includes(`./${m}.js`)) {return false;}
      const segments = m.split("/");

      return !segments
        .slice(0, -1)
        .some((_, i) =>
          index.includes(`./${segments.slice(0, i + 1).join("/")}/index.js`),
        );
    });

    expect(missing).toEqual([]);
  });
});
