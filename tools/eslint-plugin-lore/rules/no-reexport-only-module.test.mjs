import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./no-reexport-only-module.mjs";

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser },
});

ruleTester.run("no-reexport-only-module", rule, {
  valid: [
    {
      code: `export { a } from "./a.js";\nexport function compose() { return a(); }`,
      filename: "composer.ts",
    },
    {
      code: `import { a } from "./a.js";\nexport const value = a;`,
      filename: "value.ts",
    },
    {
      code: `export { a } from "./a.js";\nexport * from "./b.js";`,
      filename: "index.ts",
    },
    {
      code: `export * from "./a.js";`,
      filename: "src/index.tsx",
    },
    {
      code: `export const only = 1;`,
      filename: "only.ts",
    },
    {
      code: `export { default } from "./NewFeaturePage";`,
      filename: "app/repos/features/new/page.tsx",
    },
    {
      code: `export { a } from "./a.js";`,
      filename: "public-api.ts",
      options: [{ allow: ["public-api.ts"] }],
    },
    {
      code: `import { a } from "./a.js";\nexport default function run() { return a(); }`,
      filename: "run.ts",
    },
  ],
  invalid: [
    {
      code: `export { a } from "./a.js";`,
      filename: "advance.ts",
      errors: [{ messageId: "reexportOnly" }],
    },
    {
      code: `export { a } from "./a.js";\nexport { b } from "./b.js";\nexport type { C } from "./c.js";`,
      filename: "runner.ts",
      errors: [{ messageId: "reexportOnly" }],
    },
    {
      code: `export * from "./a.js";\nexport * from "./b.js";`,
      filename: "barrel.ts",
      errors: [{ messageId: "reexportOnly" }],
    },
    {
      code: `import { unused } from "./a.js";\nexport { b } from "./b.js";`,
      filename: "forwards.ts",
      errors: [{ messageId: "reexportOnly" }],
    },
  ],
});
