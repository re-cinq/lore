/**
 * require-status-matches-coverage — a spec.md / ADR must declare the lifecycle
 * status its test links can support, and must declare one the parsers can read.
 *
 * Status is the org's backlog signal: the web-UI pills render it, spec-status-upkeep
 * flips it, humans trust it. This rule makes it answerable to the corpus's own
 * `([validated by](test.ts#Lnn))` links rather than to whoever last edited the row:
 *
 *   no testable statement linked    -> Draft
 *   some testable statements linked -> In Progress
 *   every testable statement linked -> Shipped
 *
 * The per-doc complement of `require-statement-links` (which nags per unlinked
 * statement); both read the same `statementCoverage` walk, so the two rules can
 * never disagree about what is linked. Skips `rejected` / `retired` docs via the
 * shared `statusTier`, and docs with no testable statements (no tier to infer).
 *
 * Configured `error` in eslint.config.mjs — see `lib/status-coverage.mjs`.
 *
 * Deliberately carries no `fix`/`suggest`: the `format` CI job runs
 * `eslint --fix` and commits the result back, so a fixer here would silently
 * rewrite spec statuses across the repo on every PR. The message names the label
 * to write; a human writes it.
 */

import { statusLabel } from "@re-cinq/lore-shared/spec-status-coverage.js";
import { docKind } from "./lib/doc-kind.mjs";
import { statusMismatch } from "./lib/status-coverage.mjs";

const CORPUS = { spec: "spec", adr: "ADR" };

const REQUIREMENT = {
  spec: 'Add a `| Status | Draft |` row to the header table (one of Draft / In Progress / Shipped / Rejected / Retired).',
  adr: 'Add `status: draft` to the YAML frontmatter (one of draft / in progress / shipped / rejected / retired).',
};

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "require every spec.md / ADR to declare a parseable lifecycle status that matches its test-link coverage: no links -> Draft, some -> In Progress, all -> Shipped. Skips rejected/retired docs and docs with no testable statements.",
    },
    schema: [],
    messages: {
      untagged:
        "This {{corpus}} declares no status the parsers can read, so its coverage cannot be checked and the web-UI renders no status pill. {{requirement}}",
      statusMismatch:
        'Status "{{actual}}" does not match this {{corpus}}\'s test-link coverage — {{linked}} of {{testable}} testable statements carry a ([validated by](test.ts#Lline)) link. Either set the status to "{{expected}}", or link the remaining statements to the tests that validate them.',
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
        const mismatch = statusMismatch(text, kind);

        if (!mismatch) {
          return;
        }

        if (mismatch.reason === "untagged") {
          context.report({
            loc: { line: mismatch.line, column: 1 },
            messageId: "untagged",
            data: { corpus: CORPUS[kind], requirement: REQUIREMENT[kind] },
          });

          return;
        }
        context.report({
          loc: { line: mismatch.line, column: 1 },
          messageId: "statusMismatch",
          data: {
            corpus: CORPUS[kind],
            actual: mismatch.actual,
            expected: statusLabel(mismatch.expected, kind),
            linked: mismatch.linked,
            testable: mismatch.testable,
          },
        });
      },
    };
  },
};
