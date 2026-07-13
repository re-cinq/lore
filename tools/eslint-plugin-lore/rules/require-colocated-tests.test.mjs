import { RuleTester } from "eslint";
import rule from "./require-colocated-tests.mjs";

const ruleTester = new RuleTester();

ruleTester.run("require-colocated-tests", rule, {
  valid: [
    { code: `const a = 1;`, filename: "/repo/libs/shared/src/agent-id.test.ts" },
    { code: `const a = 1;`, filename: "/repo/libs/shared/src/agent-id.ts" },
    // a plain dir literally named tests (not __tests__) is fine
    { code: `const a = 1;`, filename: "/repo/apps/floor/src/tests-helper.ts" },
  ],
  invalid: [
    {
      code: `const a = 1;`,
      filename: "/repo/libs/shared/src/__tests__/agent-id.test.ts",
      errors: [{ messageId: "colocate" }],
    },
    {
      code: `const a = 1;`,
      filename: "/repo/libs/shared/src/spec-trace/__tests__/projector.test.ts",
      errors: [{ messageId: "colocate" }],
    },
  ],
});
