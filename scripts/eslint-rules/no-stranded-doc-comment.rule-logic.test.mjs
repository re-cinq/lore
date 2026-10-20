// specs/no-stranded-doc-comment#3
// Direct unit tests for the rule's core logic via a mock ESLint context.
// These run without the `eslint` package so they can verify rule behaviour
// independently of any parser or projectService configuration.
import { test } from "node:test";
import assert from "node:assert/strict";
import rule from "./no-stranded-doc-comment.mjs";

function docComment(value, start, end) {
  return {
    type: "Block",
    value: `* ${value} `,
    range: [start, end],
    loc: {
      start: { line: 1, column: start },
      end: { line: 1, column: end },
    },
  };
}

function runRule(comments, text, body) {
  const reported = [];
  const context = {
    report: ({ loc, messageId }) => reported.push({ loc, messageId }),
    sourceCode: {
      getAllComments: () => comments,
      text,
      ast: { body },
    },
  };

  rule.create(context).Program();

  return reported;
}

test("fires when two adjacent doc comments appear before a function declaration", () => {
  // "/** Stranded. */\n/** Real doc. */\nfunction foo() {}"
  const c1 = docComment("Stranded.", 0, 16);
  const c2 = docComment("Real doc.", 17, 33);
  const fn = { type: "FunctionDeclaration", range: [34, 52] };
  const text = "/** Stranded. */\n/** Real doc. */\nfunction foo() {}";

  const reported = runRule([c1, c2], text, [fn]);

  assert.equal(
    reported.length,
    1,
    "should report exactly one stranded comment",
  );
  assert.equal(reported[0].messageId, "stranded");
});

test("does not fire for a single doc comment before a function", () => {
  const c1 = docComment("Only comment.", 0, 20);
  const fn = { type: "FunctionDeclaration", range: [21, 42] };
  const text = "/** Only comment. */\nfunction foo() {}";

  const reported = runRule([c1], text, [fn]);

  assert.equal(reported.length, 0, "single doc comment should not be reported");
});

test("does not fire when second doc comment precedes an exported type alias", () => {
  // Simulates: /** Module doc. */\n/** Type doc. */\nexport type Foo = string;
  const c1 = docComment("Module doc.", 0, 18);
  const c2 = docComment("Type doc.", 19, 34);
  const typeAlias = { type: "TSTypeAliasDeclaration", range: [35, 60] };
  const exportDecl = {
    type: "ExportNamedDeclaration",
    declaration: typeAlias,
    range: [35, 60],
  };
  const text =
    "/** Module doc. */\n/** Type doc. */\nexport type Foo = string;";

  const reported = runRule([c1, c2], text, [exportDecl]);

  assert.equal(
    reported.length,
    0,
    "should not report when the second doc comment is followed by an exported type alias",
  );
});

test("does not fire when second doc comment precedes an exported interface", () => {
  // Simulates: /** Module doc. */\n/** Interface doc. */\nexport interface Bar {}
  const c1 = docComment("Module doc.", 0, 18);
  const c2 = docComment("Interface doc.", 19, 40);
  const iface = { type: "TSInterfaceDeclaration", range: [41, 65] };
  const exportDecl = {
    type: "ExportNamedDeclaration",
    declaration: iface,
    range: [41, 65],
  };
  const text =
    "/** Module doc. */\n/** Interface doc. */\nexport interface Bar {}";

  const reported = runRule([c1, c2], text, [exportDecl]);

  assert.equal(
    reported.length,
    0,
    "should not report when the second doc comment is followed by an exported interface",
  );
});

test("fires when the second doc comment is followed by a non-type export", () => {
  // Simulates: /** Stranded. */\n/** Real doc. */\nexport function foo() {}
  const c1 = docComment("Stranded.", 0, 16);
  const c2 = docComment("Real doc.", 17, 33);
  const fn = { type: "FunctionDeclaration", range: [47, 66] };
  const exportDecl = {
    type: "ExportNamedDeclaration",
    declaration: fn,
    range: [34, 66],
  };
  const text = "/** Stranded. */\n/** Real doc. */\nexport function foo() {}";

  const reported = runRule([c1, c2], text, [exportDecl]);

  assert.equal(
    reported.length,
    1,
    "should report when the second doc comment is followed by an exported function",
  );
});

test("does not fire when the two doc comments are not adjacent (code between them)", () => {
  // "/** First. */\nfunction bar() {}\n/** Second. */\nfunction baz() {}"
  const c1 = docComment("First.", 0, 14);
  const c2 = docComment("Second.", 34, 48);
  const fn1 = { type: "FunctionDeclaration", range: [15, 33] };
  const fn2 = { type: "FunctionDeclaration", range: [49, 67] };
  const text =
    "/** First. */\nfunction bar() {}\n/** Second. */\nfunction baz() {}";

  const reported = runRule([c1, c2], text, [fn1, fn2]);

  assert.equal(
    reported.length,
    0,
    "should not report when code separates the two doc comments",
  );
});
