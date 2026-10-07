import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

describe("lore-api and the shared Postgres pool", () => {
  it("imports getPool from @re-cinq/lore-shared/db/pg-pool.js in no source file, since initPool never runs here", () => {
    const importing = sourceFiles(SRC)
      .filter((file) =>
        /\bgetPool\b[^;]*from "@re-cinq\/lore-shared\/db\/pg-pool\.js"/s.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => path.relative(SRC, file));

    expect(importing).toEqual([]);
  });
});
