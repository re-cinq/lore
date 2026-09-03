import { RuleTester } from "eslint";
import rule from "./no-nested-loop.mjs";

const ruleTester = new RuleTester();

ruleTester.run("no-nested-loop", rule, {
  valid: [
    `for (const row of rows) { work(row); }`,
    `while (running) { tick(); }`,
    `for (const row of rows) { process(row); } for (const col of cols) { process(col); }`,
    // a callback boundary makes the inner loop its own function's loop
    `for (const row of rows) { row.cells.forEach((cell) => { while (cell.dirty) { clean(cell); } }); }`,
    `for (const row of rows) { const scan = () => { for (const cell of row) { look(cell); } }; scan(); }`,
    `if (ready) { for (const row of rows) { work(row); } }`,
  ],
  invalid: [
    {
      code: `for (const row of rows) { for (const cell of row) { work(cell); } }`,
      errors: [{ messageId: "nestedLoop" }],
    },
    {
      code: `while (a) { while (b) { tick(); } }`,
      errors: [{ messageId: "nestedLoop" }],
    },
    {
      code: `for (let i = 0; i < n; i++) { do { pump(); } while (wet); }`,
      errors: [{ messageId: "nestedLoop" }],
    },
    {
      code: `for (const key in map) { for (const other of list) { pair(key, other); } }`,
      errors: [{ messageId: "nestedLoop" }],
    },
    // an if between the loops does not un-nest them
    {
      code: `while (a) { if (b) { for (const row of rows) { work(row); } } }`,
      errors: [{ messageId: "nestedLoop" }],
    },
    {
      code: `for (const a of one) { for (const b of two) { for (const c of three) { work(); } } }`,
      errors: [{ messageId: "nestedLoop" }, { messageId: "nestedLoop" }],
    },
  ],
});
