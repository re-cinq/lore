import { RuleTester } from "eslint";
import rule from "./prefer-enforce-true.mjs";

const ruleTester = new RuleTester();

const IMPORT = `import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";`;
const IMPORT_OK = `import { enforceOk } from "@re-cinq/lore-shared/lib/enforce.js";`;

ruleTester.run("prefer-enforce-true", rule, {
  valid: [
    // already using the canonical 3-arg form
    `${IMPORT}\nenforceTrue(pool, Error, "no pool");`,
    `enforceTrue(token, Boom.unauthorized, "no token");`,
    `enforceTrue(m, (msg) => new TwoKeyError(msg, "pr_not_found"), "no PR");`,
    // not the shared helper
    `x.enforceTrue(a, b);`,
    `other(a, "b");`,
    // enforceOk has its own 2-arg shape
    `enforceOk(result, Boom.badRequest);`,
    // if with else is a real branch, not a guard
    `if (!x) { throw new Error("a"); } else { y(); }`,
    // multi-statement consequent is not a pure guard
    `if (!x) { log("bad"); throw new Error("a"); }`,
    // rethrow of the caught error inside catch is control flow, not a guard
    `try { f(); } catch (err) { if (err) throw err; }`,
    // no throw at all
    `function f(x) { if (!x) { return 1; } }`,
    // pre-built error value — the 3-arg signature can't express it
    `if (!ok) throw boom;`,
    // multi-argument constructor — needs a hand-written factory
    `if (!m) throw new TwoKeyError("msg", "code");`,
    // thrown value reads a narrowed variable and is not the `.ok`/`.error` shape
    `if (!refusal) throw new Error(refusal);`,
    `if (x === null) throw x;`,
    `if (!state.labelError) throw state.labelError;`,
    // message derived from the narrowed object, not exactly `.error`
    "if (!res.ok) throw new Error(`bad: ${res.error}`);",
    `if (!res.ok) throw new Error(res.statusText);`,
    // web-ui cannot import @re-cinq/lore-shared — never rewrite guards there
    {
      code: `if (!x) throw new Error("z");`,
      filename: "/repo/apps/web-ui/src/lib/github.ts",
    },
    // positive truthy guard reading the narrowed variable
    `if (refusal) throw new Error(refusal);`,
    `if (state.labelError) throw state.labelError;`,
    // instanceof narrows the left operand; this.x is a narrowable root
    `if (this.listResult instanceof Error) throw this.listResult;`,
    `if (!(result instanceof Error)) throw new Error(result.message);`,
  ],
  invalid: [
    {
      // negation guard -> positive condition + decomposed message, import injected
      code: `if (!pool) throw new Error("no pool");`,
      output: `${IMPORT}\nenforceTrue(pool, Error, "no pool");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // block body with single throw
      code: `${IMPORT}\nif (!secret) { throw new Error("no secret"); }`,
      output: `${IMPORT}\nenforceTrue(secret, Error, "no secret");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // bare string message
      code: `${IMPORT}\nif (!secret) throw "no secret";`,
      output: `${IMPORT}\nenforceTrue(secret, Error, "no secret");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // template-literal message
      code: "${IMPORT}\nif (!x) throw new Error(`missing ${name}`);".replace(
        "${IMPORT}",
        IMPORT,
      ),
      output: "${IMPORT}\nenforceTrue(x, Error, `missing ${name}`);".replace(
        "${IMPORT}",
        IMPORT,
      ),
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // custom error class keeps its class as the ErrorType
      code: `${IMPORT}\nif (!repo) throw new ValidationError("bad repo");`,
      output: `${IMPORT}\nenforceTrue(repo, ValidationError, "bad repo");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // Boom factory becomes the ErrorType
      code: `${IMPORT}\nif (!token) throw Boom.unauthorized("no token");`,
      output: `${IMPORT}\nenforceTrue(token, Boom.unauthorized, "no token");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // === inverts to !==
      code: `${IMPORT}\nif (x === null) throw new Error("nullish");`,
      output: `${IMPORT}\nenforceTrue(x !== null, Error, "nullish");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // < inverts to >=
      code: `${IMPORT}\nif (n < 0) throw new Error("neg");`,
      output: `${IMPORT}\nenforceTrue(n >= 0, Error, "neg");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // complex condition wrapped in !( ... )
      code: `${IMPORT}\nif (a && b) throw new Error("both");`,
      output: `${IMPORT}\nenforceTrue(!(a && b), Error, "both");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // injected import must land AFTER a leading "use client" directive
      code: `"use client";\nif (!x) throw new Error("z");`,
      output: `"use client";\n${IMPORT}\nenforceTrue(x, Error, "z");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // inside the shared package, import enforceTrue by RELATIVE path (a
      // self-package import resolves to unbuilt dist)
      code: `if (!x) throw new Error("z");`,
      filename: "/repo/libs/shared/src/project/lib/trust.ts",
      output: `import { enforceTrue } from "../../lib/enforce.js";\nenforceTrue(x, Error, "z");`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // `.error` on a DIFFERENT object than the `.ok` test is NOT the enforceOk
      // shape — but it has no narrowing dependency either, so plain enforceTrue
      code: `${IMPORT}\nif (!a.ok) throw new Error(b.error);`,
      output: `${IMPORT}\nenforceTrue(a.ok, Error, b.error);`,
      errors: [{ messageId: "preferEnforce" }],
    },
    {
      // the `.ok`/`.error` result guard becomes enforceOk — the `.error` read
      // moves inside the helper, where the narrowing is legal
      code: `if (!mapped.ok) { throw Boom.badRequest(mapped.error); }`,
      output: `${IMPORT_OK}\nenforceOk(mapped, Boom.badRequest);`,
      errors: [{ messageId: "preferEnforceOk" }],
    },
    {
      // enforceOk with a plain Error
      code: `if (!result.ok) throw new Error(result.error);`,
      output: `${IMPORT_OK}\nenforceOk(result, Error);`,
      errors: [{ messageId: "preferEnforceOk" }],
    },
    {
      // an existing enforce import is EXTENDED, not duplicated
      code: `${IMPORT}\nif (!mapped.ok) throw Boom.badRequest(mapped.error);`,
      output: `import { enforceTrue, enforceOk } from "@re-cinq/lore-shared/lib/enforce.js";\nenforceOk(mapped, Boom.badRequest);`,
      errors: [{ messageId: "preferEnforceOk" }],
    },
    {
      // legacy 2-arg call: bare-string message
      code: `enforceTrue(pool, "no pool");`,
      output: `enforceTrue(pool, Error, "no pool");`,
      errors: [{ messageId: "legacySignature" }],
    },
    {
      // legacy 2-arg call: template message
      code: "enforceTrue(repo, `unknown repo ${name}`);",
      output: "enforceTrue(repo, Error, `unknown repo ${name}`);",
      errors: [{ messageId: "legacySignature" }],
    },
    {
      // legacy 2-arg call: constructed error
      code: `enforceTrue(x, new Error("boom"));`,
      output: `enforceTrue(x, Error, "boom");`,
      errors: [{ messageId: "legacySignature" }],
    },
    {
      // legacy 2-arg call: custom class keeps the class
      code: `enforceTrue(repo, new ValidationError(reason));`,
      output: `enforceTrue(repo, ValidationError, reason);`,
      errors: [{ messageId: "legacySignature" }],
    },
    {
      // legacy 2-arg call: laziness thunk unwraps to (factory, message)
      code: `enforceTrue(secret, () => Boom.serverUnavailable("no secret"));`,
      output: `enforceTrue(secret, Boom.serverUnavailable, "no secret");`,
      errors: [{ messageId: "legacySignature" }],
    },
    {
      // multi-argument error cannot be decomposed — report without a fix
      code: `enforceTrue(m, new TwoKeyError("msg", "code"));`,
      output: null,
      errors: [{ messageId: "legacySignature" }],
    },
    {
      // pre-built error value cannot be decomposed — report without a fix
      code: `enforceTrue(ok, boom);`,
      output: null,
      errors: [{ messageId: "legacySignature" }],
    },
    {
      // eager multi-arg factory call cannot be decomposed — report without a fix
      code: `enforceTrue(bearer, denied(401, "unauthorized"));`,
      output: null,
      errors: [{ messageId: "legacySignature" }],
    },
  ],
});
