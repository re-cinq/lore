import { RuleTester } from "eslint";
import rule from "./max-comment-lines.mjs";

const ruleTester = new RuleTester();

ruleTester.run("max-comment-lines", rule, {
  valid: [
    `// one short sentence about a constraint\nconst retries = 3;`,
    `/* single-line block */\nconst retries = 3;`,
    `const retries = 3; // trailing note`,
    // separated line comments are separate one-line comments, not a run
    `// first note\nconst a = 1;\n// second note\nconst b = 2;`,
    // directives are machine instructions, exempt at any max
    {
      code: `/* eslint-disable no-console */\n// eslint-disable-next-line no-console\nconsole.log(1);`,
      options: [{ max: 0 }],
    },
    {
      code: `// @ts-expect-error upstream types lag the runtime\nconst v = load();`,
      options: [{ max: 0 }],
    },
    {
      code: `/* jscpd:ignore-start */\nconst copy = 1;\n/* jscpd:ignore-end */`,
      options: [{ max: 0 }],
    },
    { code: `const clean = 1;`, options: [{ max: 0 }] },
    // a wider budget admits a wider comment
    {
      code: `/*\n * two lines of prose\n */\nconst v = 1;`,
      options: [{ max: 3 }],
    },
  ],
  invalid: [
    {
      code: `/*\n * two lines is already an essay\n */\nconst v = 1;`,
      errors: [{ messageId: "tooLong" }],
    },
    {
      code: `// line one of the explanation\n// line two keeps going\nconst v = 1;`,
      errors: [{ messageId: "tooLong" }],
    },
    {
      code: `// one\n// two\n// three\nconst v = 1;\n// four\n// five\nconst w = 2;`,
      errors: [{ messageId: "tooLong" }, { messageId: "tooLong" }],
    },
    // max 0: any prose comment is one too many
    {
      code: `// why is this here\nconst v = 1;`,
      options: [{ max: 0 }],
      errors: [{ messageId: "noComments" }],
    },
    {
      code: `/* setup */\nconst v = 1;`,
      options: [{ max: 0 }],
      errors: [{ messageId: "noComments" }],
    },
  ],
});
