import { test } from "node:test";
import { RuleTester } from "eslint";

import rule from "./no-stranded-doc-comment.mjs";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

test("no-stranded-doc-comment flags the first of two adjacent doc comments", () => {
  tester.run("no-stranded-doc-comment", rule, {
    valid: [{ code: "/** Describes foo. */\nfunction foo() {}" }],
    invalid: [
      {
        code: "/** Stranded. */\n/** Real doc. */\nfunction foo() {}",
        errors: [{ messageId: "stranded" }],
      },
    ],
  });
});
