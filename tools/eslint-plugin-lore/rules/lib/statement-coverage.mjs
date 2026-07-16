/**
 * statement-coverage — the pure core behind `require-statement-links`.
 *
 * The inverse of the test-side `require-spec-link`: given a spec.md / ADR body,
 * return the statements that are testable (per the shared section heuristic) yet
 * carry no inline `([validated by](test.ts#Lnn))` link. Reuses the canonical
 * segmenter + classifier + link parser — the same stack the linker, the
 * spec-coverage backfill, and the web-ui coverage bar agree on — so a statement
 * flagged here is flagged the same way everywhere.
 *
 * Split out of the rule so it is testable without a RuleTester.
 */

import {
  segmentStatements,
  buildIntroOrdinals,
  classifyByHeuristic,
} from "@re-cinq/lore-shared/spec-segment.js";
import { parseTestLinksInStatement } from "@re-cinq/lore-shared/spec-link-parser.js";

/**
 * @param {string} content markdown body of a spec.md / ADR file
 * @returns {Array<{ text: string, line: number }>} testable, unlinked statements
 */
export function unlinkedTestableStatements(content) {
  const statements = segmentStatements(content);
  const introOrdinals = buildIntroOrdinals(statements);
  const unlinked = [];

  for (const statement of statements) {
    if (
      classifyByHeuristic(statement, introOrdinals).testability !== "testable"
    ) {
      continue;
    }

    if (parseTestLinksInStatement(statement.text).length > 0) {
      continue;
    }
    unlinked.push({ text: statement.text, line: statement.line });
  }

  return unlinked;
}
