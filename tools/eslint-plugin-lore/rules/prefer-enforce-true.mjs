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
import {
  importInjector,
  payloadDependsOnNarrowing,
  positiveConditionText,
  soleStatementOf,
} from "./lib/guard-shape.mjs";

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

function enclosingCatchParamName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "CatchClause") {
      return current.param?.type === "Identifier" ? current.param.name : null;
    }
  }
  return null;
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
    const enforceSource = enforceSourceFor(context.filename);
    const importFixes = importInjector(sourceCode.ast, enforceSource, (value) =>
      value.endsWith("enforce.js"),
    );

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

        const throwStatement = soleStatementOf(node.consequent, "ThrowStatement");
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
        if (payloadDependsOnNarrowing(node.test, throwStatement.argument)) {
          return;
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
