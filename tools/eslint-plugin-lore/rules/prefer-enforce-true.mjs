/**
 * prefer-enforce-true — flag an `if (!x) throw ...` guard and rewrite it to
 * `enforceTrue(x, ...)`. The house guard helper reads as a precondition and
 * narrows the checked expression; prefer it over a hand-rolled if-throw.
 *
 * Autofixable: inverts the test to the positive condition, passes the thrown
 * value through verbatim (enforceTrue accepts `string | Error | () => Error`),
 * and injects the import when missing. Skips the shapes the helper can't model:
 * `if/else`, multi-statement bodies, and rethrow-in-catch.
 */

const ENFORCE_SOURCE = "@re-cinq/lore-shared/lib/enforce.js";

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
  while (current && current.type === "MemberExpression") current = current.object;
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
    if (Array.isArray(value)) value.forEach((child) => identifiersIn(child, acc));
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

function alreadyImported(program) {
  return program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      statement.source.value === ENFORCE_SOURCE &&
      statement.specifiers.some(
        (specifier) =>
          specifier.type === "ImportSpecifier" &&
          specifier.imported.name === "enforceTrue",
      ),
  );
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "prefer enforceTrue(cond, err) over an `if (!cond) throw err` guard",
    },
    fixable: "code",
    schema: [],
    messages: {
      preferEnforce:
        "Prefer enforceTrue(cond, err) over an if-throw guard — it reads as a precondition and narrows the checked expression.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const program = sourceCode.ast;
    const needsImport = !alreadyImported(program);
    let importInjected = false;

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

    return {
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

        // Skip when the thrown value depends on a variable the test narrows —
        // enforceTrue can't preserve that narrowing (see narrowedRoots).
        const narrowed = narrowedRoots(node.test);
        if (narrowed.length) {
          const thrownIds = identifiersIn(throwStatement.argument);
          if (narrowed.some((root) => thrownIds.has(root))) return;
        }

        context.report({
          node,
          messageId: "preferEnforce",
          fix(fixer) {
            const condition = positiveConditionText(node.test, sourceCode);
            const thrown = sourceCode.getText(throwStatement.argument);
            const fixes = [
              fixer.replaceText(node, `enforceTrue(${condition}, ${thrown});`),
            ];
            if (needsImport && !importInjected) {
              importInjected = true;
              const importLine = `import { enforceTrue } from "${ENFORCE_SOURCE}";`;
              fixes.push(
                lastDirective
                  ? fixer.insertTextAfter(lastDirective, `\n${importLine}`)
                  : fixer.insertTextBeforeRange([0, 0], `${importLine}\n`),
              );
            }
            return fixes;
          },
        });
      },
    };
  },
};
