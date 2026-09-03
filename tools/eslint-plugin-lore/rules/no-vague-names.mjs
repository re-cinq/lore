/**
 * no-vague-names — bindings named `data`, `temp`, `obj`, `x` and friends say
 * nothing about what they hold; the reader has to reconstruct the meaning the
 * author already had and threw away. Name it like you mean it: `rows`,
 * `retryBudget`, `settingsPatch`.
 *
 * What is checked: names the AUTHOR chose — variable declarations (including
 * destructuring binding names), function/method parameters, function and class
 * declarations, and class members. Object literal keys, member accesses, and
 * import sources are wire/API shapes the code may not control, so they are
 * NOT checked: `const { data: rows } = res` is the sanctioned way to consume a
 * vague upstream field. The shorthand `const { data } = res` still binds a
 * local `data` and is flagged.
 *
 * Exempt: any binding declared in a classic `for (;;)` init — the one place a
 * single-letter index is idiomatic.
 *
 * Detect-only: the machine can prove the name is vague, only the author knows
 * the real one. Blocklist overridable via options `{ names: [...] }`.
 */

const DEFAULT_VAGUE_NAMES = [
  "data",
  "temp",
  "tmp",
  "stuff",
  "info",
  "obj",
  "item",
  "items",
  "misc",
  "helper",
  "helpers",
  "util",
  "utils",
  "val",
  "x",
  "y",
  "z",
  "foo",
  "bar",
  "baz",
];

function collectPatternIdentifiers(pattern, found) {
  if (!pattern) {
    return;
  }

  switch (pattern.type) {
    case "Identifier":
      found.push(pattern);

      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        collectPatternIdentifiers(
          property.type === "Property" ? property.value : property.argument,
          found,
        );
      }

      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        collectPatternIdentifiers(element, found);
      }

      return;
    case "AssignmentPattern":
      collectPatternIdentifiers(pattern.left, found);

      return;
    case "RestElement":
      collectPatternIdentifiers(pattern.argument, found);

      return;
    case "TSParameterProperty":
      collectPatternIdentifiers(pattern.parameter, found);

      return;
    default:
      return;
  }
}

function isForInitBinding(declarator) {
  const declaration = declarator.parent;

  return (
    declaration?.type === "VariableDeclaration" &&
    declaration.parent?.type === "ForStatement" &&
    declaration.parent.init === declaration
  );
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow vague binding names (data, temp, obj, x, ...) on declarations the author controls",
    },
    schema: [
      {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      vagueName:
        "'{{name}}' says nothing about what it holds — name the content (e.g. rows, retryBudget, settingsPatch).",
    },
  },
  create(context) {
    const vagueNames = new Set(
      context.options[0]?.names ?? DEFAULT_VAGUE_NAMES,
    );

    function checkIdentifiers(identifiers) {
      for (const identifier of identifiers) {
        if (vagueNames.has(identifier.name)) {
          context.report({
            node: identifier,
            messageId: "vagueName",
            data: { name: identifier.name },
          });
        }
      }
    }

    function checkPatterns(patterns) {
      const identifiers = [];

      for (const pattern of patterns) {
        collectPatternIdentifiers(pattern, identifiers);
      }

      checkIdentifiers(identifiers);
    }

    function checkFunction(node) {
      checkPatterns(node.params);

      if (node.id) {
        checkIdentifiers([node.id]);
      }
    }

    return {
      VariableDeclarator(node) {
        if (isForInitBinding(node)) {
          return;
        }

        checkPatterns([node.id]);
      },
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
      ClassDeclaration(node) {
        if (node.id) {
          checkIdentifiers([node.id]);
        }
      },
      MethodDefinition(node) {
        if (!node.computed && node.key.type === "Identifier") {
          checkIdentifiers([node.key]);
        }
      },
      PropertyDefinition(node) {
        if (!node.computed && node.key.type === "Identifier") {
          checkIdentifiers([node.key]);
        }
      },
      CatchClause(node) {
        checkPatterns(node.param ? [node.param] : []);
      },
    };
  },
};
