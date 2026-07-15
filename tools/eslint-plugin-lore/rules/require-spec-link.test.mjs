import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./require-spec-link.mjs";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "require-spec-link",
);

const OPTS = [{ specsRoot: FIXTURES }];

function file(rel) {
  return path.join(FIXTURES, rel);
}

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, sourceType: "module" },
});

ruleTester.run("require-spec-link", rule, {
  valid: [
    {
      // a spec.md links this test at line 2
      code: `describe("x", () => {\n  it("works", () => {});\n});`,
      filename: file("tests/linked.test.ts"),
      options: OPTS,
    },
    {
      // an ADR carries a whole-file link (no #L) — proves "spec OR adr"
      code: `it("anything", () => {});`,
      filename: file("tests/adr-linked.test.ts"),
      options: OPTS,
    },
    {
      // non-test file — the rule does not apply
      code: `const a = 1;`,
      filename: file("src/foo.ts"),
      options: OPTS,
    },
  ],
  invalid: [
    {
      // linked test file, but this it() sits on line 1 (the link points at line 2)
      code: `it("works", () => {});`,
      filename: file("tests/linked.test.ts"),
      options: OPTS,
      errors: [{ messageId: "unlinkedTest" }],
    },
    {
      // test file no spec/adr references at all — every it() is flagged
      code: `it("a", () => {});\nit("b", () => {});`,
      filename: file("tests/orphan.test.ts"),
      options: OPTS,
      errors: [{ messageId: "unlinkedTest" }, { messageId: "unlinkedTest" }],
    },
  ],
});
