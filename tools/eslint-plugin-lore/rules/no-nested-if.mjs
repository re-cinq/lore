/**
 * no-nested-if — an `if` may not appear inside another `if` within the same
 * function. Nesting conditionals stacks preconditions the reader must hold in
 * their head at once; the house style (see `prefer-early-return`) flattens that
 * into guard clauses or a named predicate.
 *
 * What counts as nesting: any `IfStatement` whose ancestor chain reaches
 * another `IfStatement` before reaching a function boundary. Function
 * boundaries (declarations, expressions, arrows, class static blocks) reset
 * the count — an `if` inside a callback inside an `if` is the callback's
 * business. `else if` chains are exempt: an `IfStatement` that IS its parent's
 * `alternate` sits at the same level as the chain head, not inside it, so the
 * walk continues upward from the head.
 *
 * Detect-only: the fix is a guard clause, an extracted predicate, or an
 * extracted function — human judgment, not a codemod.
 */

const FUNCTION_BOUNDARIES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "StaticBlock",
]);

function enclosingIf(node) {
  let child = node;
  let parent = node.parent;

  while (parent) {
    if (FUNCTION_BOUNDARIES.has(parent.type)) {
      return null;
    }

    const isElseIfChainLink =
      parent.type === "IfStatement" &&
      child.type === "IfStatement" &&
      parent.alternate === child;

    if (parent.type === "IfStatement" && !isElseIfChainLink) {
      return parent;
    }

    child = parent;
    parent = parent.parent;
  }

  return null;
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow an if statement nested inside another if statement in the same function (else-if chains excluded)",
    },
    schema: [],
    messages: {
      nestedIf:
        "Nested if — flatten with a guard clause, combine the conditions into a named predicate, or extract a function.",
    },
  },
  create(context) {
    return {
      IfStatement(node) {
        if (enclosingIf(node)) {
          context.report({ node, messageId: "nestedIf" });
        }
      },
    };
  },
};
