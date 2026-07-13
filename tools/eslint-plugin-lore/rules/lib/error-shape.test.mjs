import test from "node:test";
import assert from "node:assert/strict";
import * as espree from "espree";
import { SourceCode } from "eslint";
import { decomposeErrorExpression } from "./error-shape.mjs";

/** Parse `text` as a module and return [expression AST of the first statement, SourceCode]. */
function expression(text) {
  const ast = espree.parse(text, {
    ecmaVersion: "latest",
    sourceType: "module",
    loc: true,
    range: true,
    tokens: true,
    comment: true,
  });
  const sourceCode = new SourceCode({ text, ast });
  return [ast.body[0].expression, sourceCode];
}

function decompose(text) {
  const [node, sourceCode] = expression(text);
  return decomposeErrorExpression(node, sourceCode);
}

test("string literal decomposes to Error + the literal", () => {
  assert.deepEqual(decompose(`"no pool"`), {
    typeText: "Error",
    messageText: `"no pool"`,
  });
});

test("template literal decomposes to Error + the template", () => {
  assert.deepEqual(decompose("`missing ${name}`"), {
    typeText: "Error",
    messageText: "`missing ${name}`",
  });
});

test("new Error(msg) decomposes to Error + the argument text", () => {
  assert.deepEqual(decompose(`new Error("boom")`), {
    typeText: "Error",
    messageText: `"boom"`,
  });
});

test("new ValidationError(expr) keeps the class and argument verbatim", () => {
  assert.deepEqual(decompose(`new ValidationError(result.reason)`), {
    typeText: "ValidationError",
    messageText: "result.reason",
  });
});

test("factory call Boom.badRequest(msg) decomposes to callee + argument", () => {
  assert.deepEqual(decompose(`Boom.badRequest("bad repo")`), {
    typeText: "Boom.badRequest",
    messageText: `"bad repo"`,
  });
});

test("no-param arrow thunk unwraps to its body", () => {
  assert.deepEqual(decompose(`() => Boom.serverUnavailable("no secret")`), {
    typeText: "Boom.serverUnavailable",
    messageText: `"no secret"`,
  });
});

test("two-argument constructor returns null", () => {
  assert.equal(decompose(`new TwoKeyError("msg", "code")`), null);
});

test("zero-argument constructor returns null", () => {
  assert.equal(decompose(`new Error()`), null);
});

test("spread argument returns null", () => {
  assert.equal(decompose(`new Error(...parts)`), null);
});

test("bare identifier (pre-built error) returns null", () => {
  assert.equal(decompose(`boom`), null);
});

test("computed callee returns null", () => {
  assert.equal(decompose(`factories["bad"]("msg")`), null);
});

test("arrow with a parameter returns null", () => {
  assert.equal(decompose(`(m) => new Error(m)`), null);
});

test("arrow with a block body returns null", () => {
  assert.equal(decompose(`() => { return new Error("x"); }`), null);
});
