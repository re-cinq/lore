/**
 * prefer-early-return — guard clauses over else branches and wrapped tails.
 *
 * Two shapes are reported:
 *
 * 1. Any `else`. When the consequent terminates (ends in return/throw/
 *    continue/break) the else is pure nesting: de-nest it into a sibling
 *    statement — autofixed, unless the else block declares a binding that
 *    unwrapping could collide with the enclosing scope. When the consequent
 *    does NOT terminate, the branches must become two separate ifs
 *    (`if (x)` / `if (!x)`); that rewrite is left to a human, because the
 *    consequent may have changed the state the negated condition would read.
 *
 * 2. A terminating `if` (no else) whose body outweighs the statements after
 *    it — the whole happy path wrapped in `if (x) {...}` with a dangling
 *    fallback tail. Flip it: `if (!x)` guards the tail, the happy path goes
 *    flat. Detect-only; moving blocks across comments is where codemods eat
 *    code.
 */

const TERMINATORS = new Set([
  "ReturnStatement",
  "ThrowStatement",
  "ContinueStatement",
  "BreakStatement",
]);

const DECLARATIONS = new Set([
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
]);

/** A wrapped happy path is only worth flipping when it is a real block. */
const MIN_WRAPPED = 4;

/** True when control cannot flow past this statement into the next sibling. */
function terminates(statement) {
  if (!statement) return false;
  if (statement.type === "BlockStatement") {
    return terminates(statement.body[statement.body.length - 1]);
  }
  return TERMINATORS.has(statement.type);
}

/** Like {@link terminates}, but only for leaving the function entirely. */
function exits(statement) {
  if (!statement) return false;
  if (statement.type === "BlockStatement") {
    return exits(statement.body[statement.body.length - 1]);
  }
  return (
    statement.type === "ReturnStatement" || statement.type === "ThrowStatement"
  );
}

function statementCount(statement) {
  return statement.type === "BlockStatement" ? statement.body.length : 1;
}

/** Unwrapping an else block hoists its statements into the enclosing scope; a
 *  top-level declaration there could collide, so those keep a human's eyes. */
function declaresBindings(alternate) {
  if (alternate.type !== "BlockStatement") {
    return DECLARATIONS.has(alternate.type);
  }
  return alternate.body.some((statement) => DECLARATIONS.has(statement.type));
}

export default {
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Guard clauses over else branches and wrapped tails: de-nest an else after a terminating if, split a non-terminating if/else into two ifs, and flip an if that wraps the whole happy path.",
    },
    messages: {
      unnecessaryElse:
        "The if branch {{how}}, so this else only nests — de-nest its statements to follow the if.",
      splitIntoTwoIfs:
        "No else branches: split into two ifs — `if (x)` and `if (!x)` — or restructure so the first branch returns.",
      flipToGuard:
        "The happy path is wrapped in this if while {{tail}} statement(s) dangle after it — flip to `if (!(…))` guarding the tail and let the happy path run flat.",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    function fixUnnecessaryElse(fixer, node) {
      const elseToken = sourceCode.getTokenBefore(
        node.alternate,
        (token) => token.type === "Keyword" && token.value === "else",
      );

      // `else if (...)` — dropping the keyword leaves a sibling if.
      if (node.alternate.type === "IfStatement") {
        return fixer.removeRange([elseToken.range[0], node.alternate.range[0]]);
      }

      // `else { ... }` — replace keyword-through-block with the block's body.
      if (node.alternate.type === "BlockStatement") {
        const inner = sourceCode.getText(node.alternate).slice(1, -1).trim();

        return fixer.replaceTextRange(
          [elseToken.range[0], node.alternate.range[1]],
          inner,
        );
      }

      // `else statement;` — just drop the keyword.
      return fixer.removeRange([elseToken.range[0], node.alternate.range[0]]);
    }

    return {
      IfStatement(node) {
        if (node.alternate) {
          if (!terminates(node.consequent)) {
            context.report({ node, messageId: "splitIntoTwoIfs" });

            return;
          }
          const fixable = !declaresBindings(node.alternate);

          context.report({
            node: node.alternate,
            messageId: "unnecessaryElse",
            data: { how: "returns" },
            fix: fixable
              ? (fixer) => fixUnnecessaryElse(fixer, node)
              : undefined,
          });

          return;
        }

        // Shape 2: a terminating, else-less if that wraps the happy path.
        // Only `return`/`throw` wraps qualify — a chunky continue/break guard in
        // a loop is already guard-shaped, its wrapped block being the
        // exceptional path — and only a REAL block (≥ MIN_WRAPPED statements)
        // outweighing its tail is worth a warning.
        if (node.parent.type !== "BlockStatement" || !exits(node.consequent)) {
          return;
        }
        const siblings = node.parent.body;
        const tail = siblings.slice(siblings.indexOf(node) + 1);

        if (
          tail.length > 0 &&
          statementCount(node.consequent) >= MIN_WRAPPED &&
          statementCount(node.consequent) > tail.length
        ) {
          context.report({
            node,
            messageId: "flipToGuard",
            data: { tail: String(tail.length) },
          });
        }
      },
    };
  },
};
