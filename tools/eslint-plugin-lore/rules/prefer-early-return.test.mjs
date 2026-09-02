import { RuleTester } from "eslint";
import rule from "./prefer-early-return.mjs";

const ruleTester = new RuleTester();

ruleTester.run("prefer-early-return", rule, {
  valid: [
    // guard clause: small terminating if, big flat tail — the blessed shape
    `function f(run) { if (!run) { return null; } const a = 1; const b = 2; const c = 3; return render(a, b, c); }`,
    // no tail after the if — nothing to flip
    `function f(x) { if (x) { log(x); notify(x); } }`,
    // two ifs, no else — exactly what the rule asks for
    `function f(x) { if (x) { return a(); } if (!x) { return b(); } }`,
    // terminating if smaller than its tail stays a guard, not a wrap
    `function f(x) { if (x) { return early(); } const a = 1; const b = 2; return late(a, b); }`,
    // equal weight either way — no opinion
    `function f(x) { if (x) { return a(); } return b(); }`,
  ],
  invalid: [
    {
      // else after a terminating consequent: de-nest (autofix)
      code: `function f(x) { if (x) { return a(); } else { fallback(); } }`,
      output: `function f(x) { if (x) { return a(); } fallback(); }`,
      errors: [{ messageId: "unnecessaryElse" }],
    },
    {
      // else if after a terminating consequent: becomes a sibling if (autofix)
      code: `function f(x, y) { if (x) { return a(); } else if (y) { return b(); } }`,
      output: `function f(x, y) { if (x) { return a(); } if (y) { return b(); } }`,
      errors: [{ messageId: "unnecessaryElse" }],
    },
    {
      // both branches continue: split into two ifs — no autofix, the negated
      // condition may read stale state after the consequent runs
      code: `function f(x) { if (x) { x = normalize(x); } else { warn(x); } return x; }`,
      errors: [{ messageId: "splitIntoTwoIfs" }],
    },
    {
      // else whose block declares a binding: unwrapping could collide — report only
      code: `function f(x) { if (x) { return a(); } else { const y = b(); return y; } }`,
      errors: [{ messageId: "unnecessaryElse" }],
    },
    {
      // the page.tsx shape: the whole tail wrapped in if(run), fallback dangling
      code: `function f(run) { if (run) { const a = one(run); const b = two(run); const c = three(a, b); return render(c); } notFound(); return null; }`,
      errors: [{ messageId: "flipToGuard" }],
    },
    {
      // else inside a nested function is still an else
      code: `const g = { h() { if (a) { return 1; } else { return 2; } } };`,
      output: `const g = { h() { if (a) { return 1; } return 2; } };`,
      errors: [{ messageId: "unnecessaryElse" }],
    },
  ],
});
