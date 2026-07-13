import { RuleTester } from "eslint";
import rule from "./prefer-enforce-true.mjs";

const ruleTester = new RuleTester();

const IMPORT = `import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";`;

ruleTester.run("prefer-enforce-true", rule, {
  valid: [
    // already using enforceTrue
    `${IMPORT}\nenforceTrue(pool, "no pool");`,
    // if with else is a real branch, not a guard
    `if (!x) { throw new Error("a"); } else { y(); }`,
    // multi-statement consequent is not a pure guard
    `if (!x) { log("bad"); throw new Error("a"); }`,
    // rethrow of the caught error inside catch is control flow, not a guard
    `try { f(); } catch (err) { if (err) throw err; }`,
    // no throw at all
    `function f(x) { if (!x) { return 1; } }`,
    // thrown value reads a narrowed variable — enforceTrue would lose the narrowing
    `if (!result.ok) throw new Error(result.error);`,
    `if (!refusal) throw new Error(refusal);`,
    `if (x === null) throw x;`,
    `if (!state.labelError) throw state.labelError;`,
    // positive truthy guard reading the narrowed variable
    `if (refusal) throw new Error(refusal);`,
    `if (state.labelError) throw state.labelError;`,
    // instanceof narrows the left operand; this.x is a narrowable root
    `if (this.listResult instanceof Error) throw this.listResult;`,
    `if (!(result instanceof Error)) throw new Error(result.message);`,
  ],
  invalid: [
    {
      // negation guard -> positive condition, import injected
      code: `if (!pool) throw new Error("no pool");`,
      output: `${IMPORT}\nenforceTrue(pool, new Error("no pool"));`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // block body with single throw
      code: `${IMPORT}\nif (!secret) { throw new Error("no secret"); }`,
      output: `${IMPORT}\nenforceTrue(secret, new Error("no secret"));`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // === inverts to !==
      code: `${IMPORT}\nif (x === null) throw new Error("nullish");`,
      output: `${IMPORT}\nenforceTrue(x !== null, new Error("nullish"));`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // < inverts to >=
      code: `${IMPORT}\nif (n < 0) throw new Error("neg");`,
      output: `${IMPORT}\nenforceTrue(n >= 0, new Error("neg"));`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // complex condition wrapped in !( ... )
      code: `${IMPORT}\nif (a && b) throw new Error("both");`,
      output: `${IMPORT}\nenforceTrue(!(a && b), new Error("both"));`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // non-Error throw argument passed through verbatim
      code: `${IMPORT}\nif (!ok) throw boom;`,
      output: `${IMPORT}\nenforceTrue(ok, boom);`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // injected import must land AFTER a leading "use client" directive
      code: `"use client";\nif (!x) throw new Error("z");`,
      output: `"use client";\n${IMPORT}\nenforceTrue(x, new Error("z"));`,
      errors: [{ messageId: "preferEnforce" }],
    },
  ],
});
