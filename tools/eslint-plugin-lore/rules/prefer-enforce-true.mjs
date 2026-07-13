/**
 * prefer-enforce-true — one rule for the canonical house guard form. It rewrites
 * both an `if (!x) throw ...` guard AND a legacy 2-arg `enforceTrue` call to:
 *
 *   enforceTrue(cond, ErrorType, message)   — plain precondition
 *   enforceOk(result, ErrorType)            — `{ ok, error }` result guard;
 *                                             the `.error` read moves inside
 *                                             the helper where the narrowing
 *                                             is type-legal
 *
 * Autofixable: inverts the test to the positive condition, decomposes the
 * thrown/legacy error expression into (ErrorType, message) via error-shape.mjs,
 * and injects the import when missing (extending an existing enforce import in
 * place). If-throw shapes the helpers can't model stay put: `if/else`,
 * multi-statement bodies, rethrow-in-catch, pre-built error values,
 * multi-argument constructors, and thrown values that read a variable the test
 * narrows (other than the `!r.ok` / `r.error` pair, which is exactly what
 * enforceOk exists for). A legacy 2-arg CALL is always reported — without a fix
 * when non-decomposable (wrap the error in a `(message) => …` factory by hand);
 * this leg is permanent, not just a one-off migration: test files are linted
 * WITHOUT type information, so tsc never sees a legacy-form call that only
 * lives in a test.
 *
 * Import target is resolved per file: a relative path inside the shared package
 * (self-package imports resolve to unbuilt dist), the package subpath elsewhere,
 * and web-ui is skipped entirely — it cannot import `@re-cinq/lore-shared`.
 */

import path from "node:path";
import { decomposeErrorExpression } from "./lib/error-shape.mjs";

const PACKAGE_SOURCE = "@re-cinq/lore-shared/lib/enforce.js";
const SHARED_SRC_MARKER = "/libs/shared/src/";
const WEB_UI_MARKER = "/apps/web-ui/";

/** Where the enforce helpers should be imported from, given the file being linted. */
function enforceSourceFor(filename) {
  const unix = filename.replace(/\\/g, "/");
  const idx = unix.indexOf(SHARED_SRC_MARKER);
  if (idx === -1) return PACKAGE_SOURCE;
  const srcRoot = unix.slice(0, idx + SHARED_SRC_MARKER.length);
  const rel = path
    .relative(path.dirname(unix), `${srcRoot}lib/enforce.js`)
    .replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const FLIPPED_OPERATOR = {
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
  "<": ">=",
  ">": "<=",
  "<=": ">",
  ">=": "<",
};

function throwStatementOf(consequent) {
  if (consequent.type === "ThrowStatement") return consequent;
  if (
    consequent.type === "BlockStatement" &&
    consequent.body.length === 1 &&
    consequent.body[0].type === "ThrowStatement"
  ) {
    return consequent.body[0];
  }
  return null;
}

function enclosingCatchParamName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "CatchClause") {
      return current.param?.type === "Identifier" ? current.param.name : null;
    }
  }
  return null;
}

function rootIdentifier(node) {
  let current = node;
  while (current && current.type === "MemberExpression")
    current = current.object;
  if (current && current.type === "ThisExpression") return "this";
  return current && current.type === "Identifier" ? current.name : null;
}

// `typeof x === "y"` narrows x, so look through the typeof to its operand.
function narrowTarget(node) {
  return node.type === "UnaryExpression" && node.operator === "typeof"
    ? node.argument
    : node;
}

/**
 * Identifiers the test *narrows*. enforceTrue asserts the condition after the
 * call, so its arguments are typed WITHOUT that narrowing — if the thrown value
 * reads a narrowed variable (`if (!r.ok) throw r.error`), the rewrite loses the
 * narrowing and breaks. We skip those; they belong to enforceOk or stay as-is.
 */
function narrowedRoots(test) {
  // `!x` narrows the same reference as `x`; recurse through the negation.
  if (test.type === "UnaryExpression" && test.operator === "!") {
    return narrowedRoots(test.argument);
  }
  // Positive truthy test — `if (x)` / `if (x.y)` / `if (this.y)`.
  if (
    test.type === "Identifier" ||
    test.type === "MemberExpression" ||
    test.type === "ThisExpression"
  ) {
    const root = rootIdentifier(test);
    return root ? [root] : [];
  }
  // A method-call result (`if (m.has(x))`) is not a narrowable reference.
  if (test.type === "CallExpression") return [];
  if (test.type === "BinaryExpression") {
    if (test.operator === "instanceof") {
      const root = rootIdentifier(test.left);
      return root ? [root] : [];
    }
    if (["===", "!==", "==", "!="].includes(test.operator)) {
      const roots = [];
      for (const side of [test.left, test.right]) {
        if (side.type === "Literal") continue;
        if (side.type === "Identifier" && side.name === "undefined") continue;
        const root = rootIdentifier(narrowTarget(side));
        if (root) roots.push(root);
      }
      return roots;
    }
  }
  return [];
}

function identifiersIn(node, acc = new Set()) {
  if (!node || typeof node.type !== "string") return acc;
  if (node.type === "Identifier") {
    acc.add(node.name);
    return acc;
  }
  if (node.type === "ThisExpression") {
    acc.add("this");
    return acc;
  }
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value))
      value.forEach((child) => identifiersIn(child, acc));
    else if (value && typeof value.type === "string") identifiersIn(value, acc);
  }
  return acc;
}

function positiveConditionText(test, sourceCode) {
  if (test.type === "UnaryExpression" && test.operator === "!") {
    return sourceCode.getText(test.argument);
  }
  if (test.type === "BinaryExpression" && FLIPPED_OPERATOR[test.operator]) {
    const left = sourceCode.getText(test.left);
    const right = sourceCode.getText(test.right);
    return `${left} ${FLIPPED_OPERATOR[test.operator]} ${right}`;
  }
  return `!(${sourceCode.getText(test)})`;
}

function enforceImportOf(program) {
  return program.body.find(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      statement.source.value.endsWith("enforce.js"),
  );
}

function importedNames(importDeclaration) {
  if (!importDeclaration) return new Set();
  return new Set(
    importDeclaration.specifiers
      .filter((specifier) => specifier.type === "ImportSpecifier")
      .map((specifier) => specifier.imported.name),
  );
}

/**
 * Detect the enforceOk shape: `if (!<id>.ok) throw <callee>(<id>.error);`
 * where <callee> is a plain single-argument factory/class. Returns
 * `{ objectName, typeText }` or null.
 */
function enforceOkShape(test, thrown, sourceCode) {
  if (test.type !== "UnaryExpression" || test.operator !== "!") return null;
  const okRead = test.argument;
  if (
    okRead.type !== "MemberExpression" ||
    okRead.computed ||
    okRead.property.name !== "ok" ||
    okRead.object.type !== "Identifier"
  ) {
    return null;
  }
  if (
    (thrown.type !== "CallExpression" && thrown.type !== "NewExpression") ||
    thrown.arguments.length !== 1
  ) {
    return null;
  }
  const errorRead = thrown.arguments[0];
  if (
    errorRead.type !== "MemberExpression" ||
    errorRead.computed ||
    errorRead.property.name !== "error" ||
    errorRead.object.type !== "Identifier" ||
    errorRead.object.name !== okRead.object.name
  ) {
    return null;
  }
  const decomposed = decomposeErrorExpression(thrown, sourceCode);
  if (!decomposed) return null;
  return { objectName: okRead.object.name, typeText: decomposed.typeText };
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "prefer enforceTrue(cond, ErrorType, message) / enforceOk(result, ErrorType) over an `if (!cond) throw` guard",
    },
    fixable: "code",
    schema: [],
    messages: {
      preferEnforce:
        "Prefer enforceTrue(cond, ErrorType, message) over an if-throw guard — it reads as a precondition and narrows the checked expression.",
      preferEnforceOk:
        "Prefer enforceOk(result, ErrorType) over an if-throw result guard — the `.error` read moves inside the helper where the narrowing is legal.",
      legacySignature:
        "enforceTrue takes (condition, ErrorType, errorMessage) — wrap a multi-argument error in a `(message) => …` factory.",
    },
  },

  create(context) {
    // web-ui cannot import @re-cinq/lore-shared (it is not a workspace and
    // mirrors types) — never rewrite guards there.
    if (context.filename.replace(/\\/g, "/").includes(WEB_UI_MARKER)) return {};

    const sourceCode = context.sourceCode;
    const program = sourceCode.ast;
    const enforceSource = enforceSourceFor(context.filename);
    const enforceImport = enforceImportOf(program);
    const imported = importedNames(enforceImport);
    const injected = new Set();

    // The import must land after any leading directive prologue
    // (`"use client"`, `"use strict"`), which has to stay the first statement.
    let lastDirective = null;
    for (const stmt of program.body) {
      if (
        stmt.type === "ExpressionStatement" &&
        stmt.expression.type === "Literal" &&
        typeof stmt.expression.value === "string"
      ) {
        lastDirective = stmt;
      } else {
        break;
      }
    }

    function importFixes(fixer, name) {
      if (imported.has(name) || injected.has(name)) return [];
      injected.add(name);
      if (enforceImport) {
        const lastSpecifier =
          enforceImport.specifiers[enforceImport.specifiers.length - 1];
        return [fixer.insertTextAfter(lastSpecifier, `, ${name}`)];
      }
      const importLine = `import { ${name} } from "${enforceSource}";`;
      return [
        lastDirective
          ? fixer.insertTextAfter(lastDirective, `\n${importLine}`)
          : fixer.insertTextBeforeRange([0, 0], `${importLine}\n`),
      ];
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "enforceTrue" ||
          node.arguments.length !== 2 ||
          node.arguments[1].type === "SpreadElement"
        ) {
          return;
        }

        const decomposed = decomposeErrorExpression(
          node.arguments[1],
          sourceCode,
        );
        context.report({
          node,
          messageId: "legacySignature",
          fix: decomposed
            ? (fixer) =>
                fixer.replaceText(
                  node.arguments[1],
                  `${decomposed.typeText}, ${decomposed.messageText}`,
                )
            : null,
        });
      },

      IfStatement(node) {
        if (node.alternate) return;

        const throwStatement = throwStatementOf(node.consequent);
        if (!throwStatement || !throwStatement.argument) return;

        // Rethrow of the caught error is control flow, not a guard.
        if (
          throwStatement.argument.type === "Identifier" &&
          throwStatement.argument.name === enclosingCatchParamName(node)
        ) {
          return;
        }

        const okShape = enforceOkShape(
          node.test,
          throwStatement.argument,
          sourceCode,
        );
        if (okShape) {
          context.report({
            node,
            messageId: "preferEnforceOk",
            fix: (fixer) => [
              fixer.replaceText(
                node,
                `enforceOk(${okShape.objectName}, ${okShape.typeText});`,
              ),
              ...importFixes(fixer, "enforceOk"),
            ],
          });
          return;
        }

        // Skip when the thrown value depends on a variable the test narrows —
        // enforceTrue can't preserve that narrowing (see narrowedRoots).
        const narrowed = narrowedRoots(node.test);
        if (narrowed.length) {
          const thrownIds = identifiersIn(throwStatement.argument);
          if (narrowed.some((root) => thrownIds.has(root))) return;
        }

        // Only the shapes the 3-arg signature can express get rewritten;
        // pre-built errors and multi-arg constructors stay as if-throws.
        const decomposed = decomposeErrorExpression(
          throwStatement.argument,
          sourceCode,
        );
        if (!decomposed) return;

        context.report({
          node,
          messageId: "preferEnforce",
          fix: (fixer) => [
            fixer.replaceText(
              node,
              `enforceTrue(${positiveConditionText(node.test, sourceCode)}, ${decomposed.typeText}, ${decomposed.messageText});`,
            ),
            ...importFixes(fixer, "enforceTrue"),
          ],
        });
      },
    };
  },
};
