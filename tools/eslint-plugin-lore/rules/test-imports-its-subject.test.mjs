import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./test-imports-its-subject.mjs";

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser },
});
const F = "/repo/libs/shared/src/scoring.test.ts";

ruleTester.run("test-imports-its-subject", rule, {
  valid: [
    // The ordinary shape: the test imports the file it is named after.
    {
      code: `import { score } from "./scoring.js";\nit("x", () => {});`,
      filename: F,
    },
    // Extensionless and .ts spellings both resolve to the same subject.
    { code: `import { score } from "./scoring";`, filename: F },
    // A subpath import of the same module still counts.
    {
      code: `import { score } from "./scoring/index.js";`,
      filename: "/repo/libs/shared/src/scoring.test.ts",
    },
    // Importing the subject through the package barrel is how several suites
    // reach a shared function; the point is that production code is executed.
    {
      code: `import { score } from "@re-cinq/lore-shared";`,
      filename: F,
    },
    // A facet-named suite reaching its subject by a different filename: this is
    // the common, legitimate shape the first cut of this rule wrongly flagged.
    {
      code: `import { other } from "./other.js";\nimport { expect } from "vitest";`,
      filename: F,
    },
    // Not a test file at all.
    { code: `const a = 1;`, filename: "/repo/libs/shared/src/scoring.ts" },
    // All four exempt suffixes skip the check — suites that drive a system
    // rather than one module. Listing each keeps EXEMPT_SUFFIXES honest against
    // a regex regression.
    {
      code: `import { buildServer } from "./server.js";`,
      filename: "/repo/apps/lore-api/src/x.integration.test.ts",
    },
    {
      code: `import { suite } from "vitest";`,
      filename: "/repo/apps/x.acceptance.test.ts",
    },
    {
      code: `import { suite } from "vitest";`,
      filename: "/repo/apps/x.e2e.test.ts",
    },
    {
      code: `import { suite } from "vitest";`,
      filename: "/repo/apps/x.contract.test.ts",
    },
    // A suite under integration-tests/ drives a system, exactly as the
    // .integration.test suffix does — the directory is this repo's spelling.
    {
      code: `import pg from "pg";`,
      filename: "/repo/apps/lore-api/src/integration-tests/pipeline.test.ts",
    },
    // Reading the artifact under test IS loading the real subject. These suites
    // assert on a migration's SQL, a stylesheet, or the source tree — files, not
    // modules, so there is nothing for them to import.
    {
      code: `import { readFileSync } from "node:fs";\nconst sql = readFileSync("0015.sql", "utf8");`,
      filename: "/repo/apps/lore-api/src/migration-0015.test.ts",
    },
    {
      code: `import { readFileSync } from "fs";`,
      filename: "/repo/apps/web-ui/src/app/theme-tokens.test.ts",
    },
    {
      code: `import { it } from "vitest";\nconst fs = await import("node:fs");`,
      filename: F,
    },
  ],
  invalid: [
    // THE BUG: imports only vitest, then re-implements what it claims to test.
    {
      code: `import { describe, it, expect } from "vitest";\nfunction score() {}\nit("x", () => {});`,
      filename: F,
      errors: [{ messageId: "noSubjectImport" }],
    },
    // Type-only imports execute nothing at runtime.
    {
      code: `import type { Score } from "./scoring.js";\nimport { it } from "vitest";`,
      filename: F,
      errors: [{ messageId: "noSubjectImport" }],
    },
  ],
});

console.log("test-imports-its-subject: ok");

// The vi.mock + dynamic import shape, which the first cut wrongly flagged.
ruleTester.run("test-imports-its-subject (dynamic)", rule, {
  valid: [
    {
      code: `import { vi } from "vitest";\nvi.mock("./deps.js", () => ({}));\nconst { score } = await import("./scoring.js");`,
      filename: F,
    },
  ],
  invalid: [
    // A dynamic import of a third-party module still loads no first-party code.
    {
      code: `import { it } from "vitest";\nconst x = await import("pg");`,
      filename: F,
      errors: [{ messageId: "noSubjectImport" }],
    },
    // Another node builtin is not the artifact escape hatch — only reading a
    // file makes the suite's subject a file.
    {
      code: `import { createHmac } from "node:crypto";\nfunction verify() {}`,
      filename: F,
      errors: [{ messageId: "noSubjectImport" }],
    },
  ],
});
