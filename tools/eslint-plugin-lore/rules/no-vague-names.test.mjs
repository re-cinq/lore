import { RuleTester } from "eslint";
import rule from "./no-vague-names.mjs";

const ruleTester = new RuleTester();

ruleTester.run("no-vague-names", rule, {
  valid: [
    `const rows = fetchRows();`,
    `function retryBudget(attempts) { return attempts * 2; }`,
    // renaming a vague upstream field at the destructuring site is the fix
    `const { data: rows } = response;`,
    // object keys and member accesses are wire shapes, not author choices
    `const payload = { data: rows };`,
    `send(response.data);`,
    // classic for-init index is idiomatic
    `for (let x = 0; x < n; x++) { visit(x); }`,
    `class Parser { parseLine(line) { return line; } }`,
    `const [first, second] = pair;`,
    {
      code: `const data = 1;`,
      options: [{ names: ["blob"] }],
    },
  ],
  invalid: [
    {
      code: `const data = fetchRows();`,
      errors: [{ messageId: "vagueName" }],
    },
    {
      code: `let temp = swap;`,
      errors: [{ messageId: "vagueName" }],
    },
    // shorthand destructuring still binds the vague name locally
    {
      code: `const { data } = response;`,
      errors: [{ messageId: "vagueName" }],
    },
    {
      code: `function process(obj) { return obj; }`,
      errors: [{ messageId: "vagueName" }],
    },
    {
      code: `const pick = (item) => item.id;`,
      errors: [{ messageId: "vagueName" }],
    },
    {
      code: `function helper() { return 1; }`,
      errors: [{ messageId: "vagueName" }],
    },
    {
      code: `class Store { info() { return this.x; } }`,
      errors: [{ messageId: "vagueName" }],
    },
    {
      code: `const [x, rest] = pair;`,
      errors: [{ messageId: "vagueName" }],
    },
    {
      code: `for (const item of list) { use(item); }`,
      errors: [{ messageId: "vagueName" }],
    },
    {
      code: `const blob = 1;`,
      options: [{ names: ["blob"] }],
      errors: [{ messageId: "vagueName" }],
    },
  ],
});
