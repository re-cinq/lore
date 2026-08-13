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
 */

const WEBUI_MARKER = "/apps/web-ui/src/";

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
