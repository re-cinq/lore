/**
 * max-boolean-operators — a single condition may chain at most `max` boolean
 * logical operators (`&&` / `||`). Anything denser reads as a puzzle; the fix is
 * to lift the expression into a named predicate so the branch reveals intent.
 *
 * Counted contexts: `if`, `while`/`do-while`/`for` tests, ternary conditions,
 * and the right-hand side of variable declarations and assignments. `??`
 * (nullish coalescing) is value-selection, not boolean branching, so it does
 * NOT count toward the budget.
 *
 * Detect-only: extracting a named boolean is human judgment, not a mechanical
 * rewrite. Default `max` is 2 (a third operator is flagged).
 */

const BOOLEAN_OPERATORS = new Set(["&&", "||"]);

function countBooleanOps(node) {
  if (!node || typeof node !== "object") {
    return 0;
  }

  if (node.type !== "LogicalExpression") {
    return 0;
  }

  const self = BOOLEAN_OPERATORS.has(node.operator) ? 1 : 0;
  return self + countBooleanOps(node.left) + countBooleanOps(node.right);
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Limit the number of boolean logical operators in a single condition or assignment",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyOperators:
        "Condition has {{count}} boolean operators (max {{max}}) — extract a named predicate.",
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? 2;

    function check(expression) {
      if (!expression) {
        return;
      }

      const count = countBooleanOps(expression);
      if (count > max) {
        context.report({
          node: expression,
          messageId: "tooManyOperators",
          data: { count, max },
        });
      }
    }

    return {
      IfStatement: (node) => check(node.test),
      WhileStatement: (node) => check(node.test),
      DoWhileStatement: (node) => check(node.test),
      ForStatement: (node) => check(node.test),
      ConditionalExpression: (node) => check(node.test),
      VariableDeclarator: (node) => check(node.init),
      AssignmentExpression: (node) => check(node.right),
    };
  },
};
