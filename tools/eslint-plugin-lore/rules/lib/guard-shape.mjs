/**
 * The AST vocabulary shared by the guard-rewriting rules (`prefer-enforce-true`,
 * `prefer-api-error`): what a guard's test NARROWS, how to say that test
 * positively, and how to inject the helper import the rewrite needs.
 *
 * Extracted verbatim from prefer-enforce-true so both rules answer "is this
 * rewrite safe?" the same way — the narrowing question in particular has a
 * subtle answer (see `narrowedRoots`) that must not be re-derived per rule.
 */

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

export function rootIdentifier(node) {
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
 * call, so its arguments are typed WITHOUT that narrowing — if the guard's
 * payload reads a narrowed variable (`if (!r.ok) throw r.error`), the rewrite
 * loses the narrowing and breaks. Callers skip those.
 */
export function narrowedRoots(test) {
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
    // `"error" in result` narrows the RIGHT operand — the discriminated branch
    // is where `result.error` exists at all.
    if (test.operator === "in") {
      const root = rootIdentifier(test.right);
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

export function identifiersIn(node, acc = new Set()) {
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

/** True when rewriting the guard would strip narrowing its payload depends on. */
export function payloadDependsOnNarrowing(test, payloadNode) {
  const narrowed = narrowedRoots(test);
  if (!narrowed.length) return false;
  const ids = identifiersIn(payloadNode);
  return narrowed.some((root) => ids.has(root));
}

/** The guard's test said the other way round, as source text. */
export function positiveConditionText(test, sourceCode) {
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

/** The single statement of a guard's consequent, if it has exactly one of `type`. */
export function soleStatementOf(consequent, type) {
  if (consequent.type === type) return consequent;
  if (
    consequent.type === "BlockStatement" &&
    consequent.body.length === 1 &&
    consequent.body[0].type === type
  ) {
    return consequent.body[0];
  }
  return null;
}

/**
 * An import injector for one module: reports which names are already imported
 * and produces the fixes that add the missing ones, extending an existing
 * import of the same module in place rather than adding a second declaration.
 */
export function importInjector(program, source, matches) {
  const declaration = program.body.find(
    (statement) =>
      statement.type === "ImportDeclaration" && matches(statement.source.value),
  );
  const imported = new Set(
    (declaration?.specifiers ?? [])
      .filter((specifier) => specifier.type === "ImportSpecifier")
      .map((specifier) => specifier.imported.name),
  );
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

  return (fixer, name) => {
    if (imported.has(name) || injected.has(name)) return [];
    injected.add(name);
    if (declaration) {
      const last = declaration.specifiers[declaration.specifiers.length - 1];
      return [fixer.insertTextAfter(last, `, ${name}`)];
    }
    const importLine = `import { ${name} } from "${source}";`;
    return [
      lastDirective
        ? fixer.insertTextAfter(lastDirective, `\n${importLine}`)
        : fixer.insertTextBeforeRange([0, 0], `${importLine}\n`),
    ];
  };
}
