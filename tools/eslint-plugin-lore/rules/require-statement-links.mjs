/**
 * require-statement-links — every testable statement in a spec.md / ADR must
 * carry an inline `([validated by](test.ts#Lnn))` link.
 *
 * The statement-side complement of `require-spec-link` (which enforces the same
 * link from the test's side). It walks each `.md` body, keeps the statements the
 * shared section heuristic calls *testable* (intro / vision / background /
 * rationale / open-question / limitation prose is exempt), and reports any with
 * no test link — see `lib/statement-coverage.mjs`.
 *
 * ESLint severity is static per rule, but the requirement is warn-normally /
 * error-when-finalized. So one core is exported as two rules, gated on the doc's
 * parsed status (`@re-cinq/lore-shared/spec-status.js`) and configured at
 * different severities in eslint.config.mjs:
 *   - default export        → fires on NON-finalized docs        → `warn`
 *   - `finalized` export     → fires on finalized docs           → `error`
 *     (a spec with `| Status | Shipped |`, or an ADR with `status: accepted`)
 * A doc matches exactly one variant, so the two never double-report.
 */

import { parseDocStatus } from "@re-cinq/lore-shared/spec-status.js";
import { unlinkedTestableStatements } from "./lib/statement-coverage.mjs";

const EXCERPT_MAX = 60;

/** spec.md lives under `specs/`, ADRs under `adrs/`; anything else is out of scope. */
function docKind(filename) {
  const posix = filename.split("\\").join("/");

  if (posix.includes("/adrs/") || posix.startsWith("adrs/")) {
    return "adr";
  }

  if (posix.includes("/specs/") || posix.startsWith("specs/")) {
    return "spec";
  }

  return null;
}

function excerpt(text) {
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;
}

function makeRule({ finalizedOnly }) {
  return {
    meta: {
      type: "problem",
      docs: {
        description:
          "require every testable spec.md / ADR statement to carry an inline ([validated by](test.ts#Lline)) link. Warns on non-finalized docs; errors on finalized ones (spec Status Shipped / ADR status accepted).",
      },
      schema: [],
      messages: {
        unlinkedStatement:
          'Testable {{status}} statement has no ([validated by](test.ts#Lline)) link: "{{excerpt}}". Link it to the test that validates it, or move it under a narrative section (Background / Rationale / Open Questions …).',
      },
    },

    create(context) {
      const kind = docKind(context.filename);

      if (!kind) {
        return {};
      }
      const text = context.sourceCode.getText();
      const { isFinalized, status } = parseDocStatus(text, kind);

      if (isFinalized !== finalizedOnly) {
        return {};
      }

      return {
        "root:exit"() {
          for (const statement of unlinkedTestableStatements(text)) {
            context.report({
              loc: { line: statement.line, column: 1 },
              messageId: "unlinkedStatement",
              data: {
                status: status ?? kind,
                excerpt: excerpt(statement.text),
              },
            });
          }
        },
      };
    },
  };
}

export default makeRule({ finalizedOnly: false });
export const finalized = makeRule({ finalizedOnly: true });
