import { RuleTester } from "eslint";
import rule from "./no-nested-if.mjs";

const ruleTester = new RuleTester();

ruleTester.run("no-nested-if", rule, {
  valid: [
    `if (a) { work(); }`,
    `if (a) { work(); } else { rest(); }`,
    // else-if chains sit at one level, not inside each other
    `if (a) { one(); } else if (b) { two(); } else if (c) { three(); }`,
    // a function boundary resets the nesting count
    `if (a) { items.map((item) => { if (item.ok) { return item; } }); }`,
    `if (a) { const pick = () => { if (b) { return 1; } }; }`,
    `function outer() { if (a) { work(); } } function other() { if (b) { rest(); } }`,
    // sibling ifs in one block are sequential guards, not nesting
    `function guards() { if (!a) { return; } if (!b) { return; } work(); }`,
    `class C { static { if (a) { init(); } } }`,
  ],
  invalid: [
    {
      code: `if (a) { if (b) { work(); } }`,
      errors: [{ messageId: "nestedIf" }],
    },
    {
      code: `if (a) { while (b) { if (c) { work(); } } }`,
      errors: [{ messageId: "nestedIf" }],
    },
    // nesting inside an else-if arm is still nesting
    {
      code: `if (a) { one(); } else if (b) { if (c) { two(); } }`,
      errors: [{ messageId: "nestedIf" }],
    },
    // an if in the else BLOCK (not an else-if chain link) is nested
    {
      code: `if (a) { one(); } else { if (b) { two(); } three(); }`,
      errors: [{ messageId: "nestedIf" }],
    },
    {
      code: `function f() { if (a) { try { risky(); } catch { if (b) { recover(); } } } }`,
      errors: [{ messageId: "nestedIf" }],
    },
    {
      code: `if (a) { if (b) { if (c) { work(); } } }`,
      errors: [{ messageId: "nestedIf" }, { messageId: "nestedIf" }],
    },
  ],
});
