import { RuleTester } from "eslint";
import rule from "./max-boolean-operators.mjs";

const ruleTester = new RuleTester();

ruleTester.run("max-boolean-operators", rule, {
  valid: [
    `if (a && b) {}`,
    `if (a && b || c) {}`,
    `if (a && b && c) {}`,
    `while (a || b) {}`,
    `const x = a && b || c;`,
    `x = a || b;`,
    `const x = a ?? b ?? c ?? d;`,
    `const x = (a && b) ?? c;`,
    `const x = (a && b) ?? (c && d);`,
    `for (let i = 0; a && b; i++) {}`,
    `for (;;) {}`,
    `const y = a && b && c ? 1 : 2;`,
  ],
  invalid: [
    {
      code: `if (a && b && c && d) {}`,
      errors: [{ messageId: "tooManyOperators" }],
    },
    {
      code: `while (a || b || c || d) {}`,
      errors: [{ messageId: "tooManyOperators" }],
    },
    {
      code: `do {} while (a && b && c && d);`,
      errors: [{ messageId: "tooManyOperators" }],
    },
    {
      code: `for (let i = 0; a && b && c && d; i++) {}`,
      errors: [{ messageId: "tooManyOperators" }],
    },
    {
      code: `const x = a && b || c && d;`,
      errors: [{ messageId: "tooManyOperators" }],
    },
    {
      code: `x = a || b || c || d;`,
      errors: [{ messageId: "tooManyOperators" }],
    },
    {
      code: `const y = a && b && c && d ? 1 : 2;`,
      errors: [{ messageId: "tooManyOperators" }],
    },
    // ?? is not a boundary — operators on both sides share one budget
    {
      code: `const x = (a && b && c) ?? (d && e);`,
      errors: [{ messageId: "tooManyOperators" }],
    },
  ],
});
