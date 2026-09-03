/**
 * no-nested-loop — a loop may not appear inside another loop within the same
 * function. A loop-in-loop is two responsibilities sharing one scope: the
 * inner traversal deserves its own name (an extracted function) or an array
 * method (`map`/`filter`/`flatMap`/`some`), which also makes the O(n*m) shape
 * visible at the call site.
 *
 * What counts as nesting: any loop node (`for`, `for-in`, `for-of`, `while`,
 * `do-while`) whose ancestor chain reaches another loop node before reaching a
 * function boundary. Function boundaries reset the count — a loop inside a
 * callback passed within a loop is the callback's own, single loop.
 *
 * Detect-only: choosing between an extracted function, `flatMap`, or a lookup
 * map that removes the inner scan entirely is design, not a codemod.
 */

const LOOP_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const FUNCTION_BOUNDARIES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "StaticBlock",
]);

function enclosingLoop(node) {
  let parent = node.parent;

  while (parent) {
    if (FUNCTION_BOUNDARIES.has(parent.type)) {
      return null;
    }

    if (LOOP_TYPES.has(parent.type)) {
      return parent;
    }

    parent = parent.parent;
  }

  return null;
}

function checkLoop(context, node) {
  if (enclosingLoop(node)) {
    context.report({ node, messageId: "nestedLoop" });
  }
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow a loop nested inside another loop in the same function",
    },
    schema: [],
    messages: {
      nestedLoop:
        "Nested loop — extract the inner traversal into a named function, use an array method, or precompute a lookup map.",
    },
  },
  create(context) {
    return {
      ForStatement: (node) => checkLoop(context, node),
      ForInStatement: (node) => checkLoop(context, node),
      ForOfStatement: (node) => checkLoop(context, node),
      WhileStatement: (node) => checkLoop(context, node),
      DoWhileStatement: (node) => checkLoop(context, node),
    };
  },
};
