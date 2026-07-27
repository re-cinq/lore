/**
 * require-statement-links — every testable statement in a spec.md / ADR must
 * carry an inline `([validated by](test.ts#Lnn))` link.
 *
 * The statement-side complement of `require-spec-link` (which enforces the same
 * link from the test's side). It walks each `.md` body, keeps the statements the
 * shared section heuristic calls *testable* (intro / vision / background /
 * rationale / open-question / limitation prose is exempt), and reports any with
 * no test link — see `@re-cinq/lore-shared/spec-status-coverage.js`.
 *
 * Reporting is gated on the doc's normalized lifecycle status
 * (`@re-cinq/lore-shared/spec-status.js` — specs and ADRs fold into the same
 * buckets): a `rejected` (never accepted) or `retired` (shipped then
 * superseded/removed) doc skips the rule entirely; every other status warns.
 * Configured `warn` in eslint.config.mjs.
 */

import {
  parseDocStatus,
  statusTier,
  unlinkedTestableStatements,
} from "./lib/lore-shared.mjs";
import { docKind } from "./lib/doc-kind.mjs";

const EXCERPT_MAX = 60;

function excerpt(text) {
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "require every testable spec.md / ADR statement to carry an inline ([validated by](test.ts#Lline)) link. Skips rejected specs / superseded ADRs; warns on everything else.",
    },
    schema: [],
    messages: {
      unlinkedStatement:
        'Testable statement in a {{status}} spec/ADR has no test link — add ([validated by](path/to/test.ts#Lline)) to the test that validates it, or move it under a narrative heading (Background / Rationale / Open Questions …) if it states no testable behaviour. Statement: "{{excerpt}}"',
    },
  },

  create(context) {
    const kind = docKind(context.filename);

    if (!kind) {
      return {};
    }
    const text = context.sourceCode.getText();
    const { status } = parseDocStatus(text, kind);

    if (statusTier(status) === "skip") {
      return {};
    }

    return {
      "root:exit"() {
        for (const statement of unlinkedTestableStatements(text)) {
          context.report({
            loc: { line: statement.line, column: 1 },
            messageId: "unlinkedStatement",
            data: {
              status: status ?? "untagged",
              excerpt: excerpt(statement.text),
            },
          });
        }
      },
    };
  },
};
