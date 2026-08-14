/**
 * No inline `style` props in the web UI — styling belongs in a stylesheet.
 *
 * 175 of them had accumulated, and the same object recurs constantly
 * (`display:flex; align-items:center; gap:N` appears dozens of times), so there is
 * no single place to change a spacing decision.
 *
 * Reported at `warn`: a rule that red-lights every PR on day one gets disabled
 * rather than obeyed. Verticals convert one at a time.
 *
 * A computed `style={obj}` is reported too — the styling decision is still sitting
 * in the component. Genuinely dynamic renderers (SVG transforms, measured heights)
 * turn the rule off by path in eslint.config.mjs, where the exemption is visible
 * and reviewable, rather than by silent tolerance here.
 *
 * The one shape that passes is an object of nothing but CSS custom properties —
 * `style={{ "--pill-color": SPEC_STATUS_COLOR[status] }}`. That is not a styling
 * decision in the component: the rules still live in the stylesheet (`.status-pill`
 * reads `var(--pill-color)`), and the component only hands it a value from a palette
 * shared with the canvas renderers, which cannot use classes at all.
 */

const WEBUI_MARKER = "/apps/web-ui/src/";

/** `"--x"`, `` `--x` ``, and the `["--x" as string]` cast the TS types force. */
function customPropertyName(node) {
  if (node?.type === "TSAsExpression" || node?.type === "TSTypeAssertion") {
    return customPropertyName(node.expression);
  }

  if (node?.type === "Literal") {
    return typeof node.value === "string" && node.value.startsWith("--");
  }

  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked?.startsWith("--") === true;
  }

  return false;
}

/**
 * An object literal that sets custom properties and nothing else. Unwraps the
 * `as CSSProperties` cast callers need, since `CSSProperties` has no index
 * signature for `--*` keys — written around the object or around each key.
 */
function customPropertiesOnly(node) {
  if (node?.type === "TSAsExpression" || node?.type === "TSTypeAssertion") {
    return customPropertiesOnly(node.expression);
  }

  if (node?.type !== "ObjectExpression" || node.properties.length === 0) {
    return false;
  }

  return node.properties.every(
    (property) =>
      property.type === "Property" && customPropertyName(property.key),
  );
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "styling lives in a stylesheet, not in a JSX style prop, so a shared decision has one home",
    },
    schema: [],
    messages: {
      inlineStyle:
        "Inline style on <{{element}}>. Move it to the colocated *.module.scss — an inline object cannot be shared, so the same rule ends up copied.",
    },
  },

  create(context) {
    const filename = (context.filename ?? "").split("\\").join("/");

    if (!filename.includes(WEBUI_MARKER)) {
      return {};
    }

    return {
      JSXAttribute(node) {
        if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") {
          return;
        }

        if (
          node.value?.type === "JSXExpressionContainer" &&
          customPropertiesOnly(node.value.expression)
        ) {
          return;
        }
        const owner = node.parent?.name;

        context.report({
          node,
          messageId: "inlineStyle",
          data: {
            element: owner?.type === "JSXIdentifier" ? owner.name : "element",
          },
        });
      },
    };
  },
};
