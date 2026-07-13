/**
 * error-shape — decompose a thrown-error expression into the canonical
 * `enforceTrue(cond, ErrorType, message)` argument pair. Returns
 * `{ typeText, messageText }` when the expression is one of the shapes the
 * 3-arg signature can express, `null` otherwise (multi-arg constructors,
 * pre-built error values, computed callees — those need a hand-written
 * `(message) => …` factory or should stay as an if-throw).
 */

/** Is `callee` a plain name — an Identifier or a non-computed member chain? */
function isPlainCallee(callee) {
  if (callee.type === "Identifier") return true;
  if (callee.type === "MemberExpression" && !callee.computed) {
    return isPlainCallee(callee.object);
  }
  return callee.type === "ThisExpression";
}

export function decomposeErrorExpression(node, sourceCode) {
  // Bare message: enforceTrue wraps it in Error itself.
  if (node.type === "Literal" && typeof node.value === "string") {
    return { typeText: "Error", messageText: sourceCode.getText(node) };
  }
  if (node.type === "TemplateLiteral") {
    return { typeText: "Error", messageText: sourceCode.getText(node) };
  }
  // Legacy laziness thunk `() => <error expr>` — unwrap to its body.
  if (
    node.type === "ArrowFunctionExpression" &&
    node.params.length === 0 &&
    node.body.type !== "BlockStatement"
  ) {
    return decomposeErrorExpression(node.body, sourceCode);
  }
  // `new X(msg)` / `factory(msg)` with exactly one non-spread argument.
  if (
    (node.type === "NewExpression" || node.type === "CallExpression") &&
    node.arguments.length === 1 &&
    node.arguments[0].type !== "SpreadElement" &&
    isPlainCallee(node.callee)
  ) {
    return {
      typeText: sourceCode.getText(node.callee),
      messageText: sourceCode.getText(node.arguments[0]),
    };
  }
  return null;
}
