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
 * Enforcement is tiered by the doc's normalized lifecycle status
 * (`@re-cinq/lore-shared/spec-status.js` — specs and ADRs fold into the same
 * buckets): `rejected` skips the rule entirely, `shipped` errors, everything
 * else (draft / in-progress / unknown) warns. ESLint severity is static per
 * rule, so one core is exported as two rules configured at the two severities
 * in eslint.config.mjs, each firing only on its tier:
 *   - default export     → fires on the `warn` tier   → `warn`
 *   - `shipped` export    → fires on the `error` tier  → `error`
 * A doc's tier matches at most one variant (and `rejected` matches neither), so
 * the two never double-report.
 */

import {
  parseDocStatus,
  statusTier,
} from "@re-cinq/lore-shared/spec-status.js";
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

function makeRule({ tier }) {
  return {
    meta: {
      type: "problem",
      docs: {
        description:
          "require every testable spec.md / ADR statement to carry an inline ([validated by](test.ts#Lline)) link. Tiered by lifecycle status: rejected skips, shipped errors, draft/in-progress warn.",
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

      if (statusTier(status) !== tier) {
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
}

export default makeRule({ tier: "warn" });
export const shipped = makeRule({ tier: "error" });
