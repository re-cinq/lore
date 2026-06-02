/**
 * Server-side derivation of the v3 coverage payload from a spec's
 * raw markdown content. Pure: segments, classifies, and parses the
 * trailing test-link parenthetical from each statement. No DB.
 *
 * Used by /repos/:owner/:repo/specs (list page) and
 * /repos/:owner/:repo/specs/[...path] (detail page).
 */

import {
  segmentStatements,
  buildIntroOrdinals,
  classifyByHeuristic,
  parseTestLinksInStatement,
  type TestLinkRef,
} from '@re-cinq/lore-shared';

export type StatementState = 'tested' | 'untested' | 'narrative';

export interface DerivedStatement {
  ordinal: number;
  text: string;
  kind: string;
  state: StatementState;
  category: string | null;
  testLinks: TestLinkRef[];
}

export interface DerivedCoverage {
  statements: DerivedStatement[];
  counts: { testable: number; covered: number; untestable: number };
}

export function deriveCoverageFromMarkdown(content: string): DerivedCoverage {
  const segments = segmentStatements(content);
  const introOrdinals = buildIntroOrdinals(segments);

  const statements: DerivedStatement[] = segments.map((s) => {
    const c = classifyByHeuristic(s, introOrdinals);
    const testLinks = parseTestLinksInStatement(s.text);
    let state: StatementState;
    if (c.testability === 'untestable') {
      state = 'narrative';
    } else if (testLinks.length > 0) {
      state = 'tested';
    } else {
      state = 'untested';
    }
    return {
      ordinal: s.ordinal,
      text: s.text,
      kind: s.kind,
      state,
      category: c.category,
      testLinks,
    };
  });

  const testable = statements.filter((s) => s.state !== 'narrative').length;
  const covered = statements.filter((s) => s.state === 'tested').length;
  const untestable = statements.filter((s) => s.state === 'narrative').length;

  return { statements, counts: { testable, covered, untestable } };
}
