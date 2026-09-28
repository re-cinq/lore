import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import {
  isTestFile,
  normalizeTestName,
  TEST_PATH_SQL_PATTERN,
} from "./test-paths.js";

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "lore",
  user: process.env.PGUSER ?? "lore",
  password: process.env.PGPASSWORD ?? "lore",
  connectionTimeoutMillis: 1000,
};

async function pgReachable(): Promise<boolean> {
  const probe = new Pool(PG_CONFIG);

  try {
    await probe.query("SELECT 1");

    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const pgUp = await pgReachable();

describe("isTestFile", () => {
  const testPaths = [
    "mcp-server/src/local-runner.test.ts",
    "web-ui/src/lib/spec-summary.test.tsx",
    "agent/src/jobs/spec-test-linker.spec.ts",
    "src/__tests__/router.ts",
    "pkg/store/store_test.go",
    "api/tests/test_user.py",
    "api/user_test.py",
    "src/main/CalculatorTest.java",
    "src/test/CalculatorTests.kt",
    "src/store/store_test.rs",
    "spec/models/user_spec.rb",
    "Tests/CalculatorTests.cs",
    "tests/CalculatorTest.php",
  ];
  const productionPaths = [
    "shared/src/test-paths.ts",
    "mcp-server/src/routes.ts",
    "specs/local-task-runner/spec.md",
    "src/tested/handler.ts",
    "pkg/store/store.go",
    "app/foo.py",
    "src/Production.java",
    "src/foo.rs",
    "lib/foo.rb",
    "src/Service.cs",
    "src/Controller.php",
  ];

  it("recognizes test-path conventions across languages and rejects production paths", () => {
    expect({
      tests: testPaths.map(isTestFile),
      production: productionPaths.map(isTestFile),
    }).toEqual({
      tests: testPaths.map(() => true),
      production: productionPaths.map(() => false),
    });
  });

  describe.skipIf(!pgUp)("in Postgres", () => {
    it("matches the same 13 test paths and 11 production paths in Postgres through TEST_PATH_SQL_PATTERN", async () => {
      const pool = new Pool(PG_CONFIG);

      try {
        const { rows } = await pool.query<{ matches: boolean }>(
          "SELECT path ~ $2 AS matches FROM unnest($1::text[]) AS path",
          [[...testPaths, ...productionPaths], TEST_PATH_SQL_PATTERN],
        );

        expect(rows.map((row) => row.matches)).toEqual([
          ...testPaths.map(isTestFile),
          ...productionPaths.map(isTestFile),
        ]);
      } finally {
        await pool.end();
      }
    });
  });
});

describe("normalizeTestName", () => {
  it("lowercases, collapses whitespace and joins with a wedge", () => {
    expect(
      normalizeTestName("  shouldSkipDrift ", "suppresses   within cooldown"),
    ).toBe("shouldskipdrift › suppresses within cooldown");
  });

  it("omits an empty describe segment", () => {
    expect(normalizeTestName("", "claims pending task")).toBe(
      "claims pending task",
    );
  });

  it("returns identical keys for the same test described with differing whitespace", () => {
    expect(normalizeTestName("local runner", "claims task")).toBe(
      normalizeTestName("local   runner", "claims  task"),
    );
  });
});
