/**
 * no-prop-mutation — data down, actions up (DDAU). A component receives its data
 * as read-only props (arguments) and, to change state, invokes an action
 * (callback) prop rather than mutating what it was handed. This flags mutation
 * of the props parameter: assignment/update/delete through it, and in-place
 * mutating method calls (push/sort/set/…) on it.
 *
 * Scope-based (resolves each mutation's root identifier back to the props-param
 * variable, so a local that merely shares a prop's name is never flagged). Only
 * the FIRST parameter is treated as props — a forwardRef's second `ref` arg and
 * its `.current` writes are left alone.
 *
 * Detect-only: the fix is to lift state to the owner and pass an action down —
 * human judgment, not a mechanical rewrite. web-ui only.
 */

const WEBUI_MARKER = "/apps/web-ui/";
const MUTATORS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

function componentName(node) {
  if (node.id && node.id.type === "Identifier") {
    return node.id.name;
  }

  const parent = node.parent;
  if (
    parent &&
    parent.type === "VariableDeclarator" &&
    parent.id.type === "Identifier"
  ) {
    return parent.id.name;
  }

  return null;
}

function isComponentName(name) {
  return typeof name === "string" && /^[A-Z]/.test(name);
}

function rootIdentifier(node) {
  let current = node;
  while (current && current.type === "MemberExpression") {
    current = current.object;
  }

  return current && current.type === "Identifier" ? current : null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "disallow mutating props in web-ui components — data flows down read-only, changes flow up via callback props (DDAU)",
    },
    schema: [],
    messages: {
      propMutation:
        "Don't mutate props ('{{name}}') — data flows down read-only; send the change up via a callback prop (data down, actions up).",
    },
  },

  create(context) {
    if (!context.filename.replace(/\\/g, "/").includes(WEBUI_MARKER)) {
      return {};
    }

    const sourceCode = context.sourceCode;
    const propRefs = new Set();

    function collectProps(node) {
      if (!isComponentName(componentName(node)) || !node.params[0]) {
        return;
      }

      const [start, end] = node.params[0].range;
      for (const variable of sourceCode.getDeclaredVariables(node)) {
        const def = variable.defs[0];
        if (!def || def.type !== "Parameter") {
          continue;
        }

        if (def.name.range[0] < start || def.name.range[1] > end) {
          continue;
        }

        for (const reference of variable.references) {
          propRefs.add(reference.identifier);
        }
      }
    }

    function flagIfProp(target, reportNode) {
      const root = rootIdentifier(target);
      if (root && propRefs.has(root)) {
        context.report({
          node: reportNode,
          messageId: "propMutation",
          data: { name: sourceCode.getText(target) },
        });
      }
    }

    return {
      FunctionDeclaration: collectProps,
      FunctionExpression: collectProps,
      ArrowFunctionExpression: collectProps,

      AssignmentExpression(node) {
        flagIfProp(node.left, node);
      },
      UpdateExpression(node) {
        flagIfProp(node.argument, node);
      },
      UnaryExpression(node) {
        if (node.operator === "delete") {
          flagIfProp(node.argument, node);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier" &&
          MUTATORS.has(callee.property.name)
        ) {
          flagIfProp(callee.object, node);
        }
      },
    };
  },
};
