/**
 * require-intro-paragraph — every spec.md / ADR must open with a real lead
 * paragraph so the web-UI spec/ADR cards have prose to render as the doc's
 * description (spec cards show the first statement; ADR cards the first
 * non-heading line). A doc that jumps from its title straight into a metadata
 * table, a bare `## Status`, or a `## Section` heading gives the card nothing.
 *
 * The lead paragraph must sit after the title (specs: below the status table;
 * ADRs: below the frontmatter + H1) and BEFORE the first `##` section — the
 * placement check lives in `lib/intro-paragraph.mjs`.
 *
 * Flat `error` for every spec.md / ADR regardless of lifecycle status (unlike
 * the tiered `require-statement-links`): a card renders the same whether the doc
 * is Draft or Shipped.
 */

import { docKind } from "./lib/doc-kind.mjs";
import { hasLeadParagraph } from "./lib/intro-paragraph.mjs";

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "require every spec.md / ADR to open with a lead paragraph (after the title, before the first ## section) so the web-UI card renders a description.",
    },
    schema: [],
    messages: {
      missingIntro:
        "Add a 1–2 sentence introductory paragraph (at least 40 characters) after the title (specs: below the status table; ADRs: below the H1) and before the first `##` section — the web-UI card renders it as the doc's description.",
    },
  },

  create(context) {
    const kind = docKind(context.filename);

    if (!kind) {
      return {};
    }
    const text = context.sourceCode.getText();

    return {
      "root:exit"() {
        if (!hasLeadParagraph(text, kind)) {
          context.report({
            loc: { line: 1, column: 1 },
            messageId: "missingIntro",
          });
        }
      },
    };
  },
};
