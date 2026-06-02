// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpecDetails, { type StatementInfo, type TestLink } from './SpecDetails';

const testLink = (overrides: Partial<TestLink> = {}): TestLink => ({
  name: 'x › claims',
  file_path: 'src/x.test.ts',
  line: 12,
  symbol: null,
  match_kind: 'directory',
  rationale: 'covers the path',
  statement_ordinal: 1,
  match_score: 0.8,
  url: 'https://github.com/re-cinq/lore/blob/HEAD/src/x.test.ts#L12',
  ...overrides,
});

const stmt = (overrides: Partial<StatementInfo> = {}): StatementInfo => ({
  ordinal: 0,
  text: 'Default text.',
  kind: 'sentence',
  testability: 'testable',
  category: null,
  ...overrides,
});

describe('SpecDetails rehype highlighter', () => {
  it('wraps a contiguous plain-prose testable statement in a mark with state class', () => {
    const statements = [
      stmt({ ordinal: 1, text: 'It claims a pending task.', testability: 'testable' }),
    ];
    const { container } = render(
      <SpecDetails
        content={'## Section\n\nIt claims a pending task.\n'}
        tests={[testLink({ statement_ordinal: 1 })]}
        statements={statements}
      />
    );
    const mark = container.querySelector('mark[data-ordinal="1"]');
    expect(mark).not.toBeNull();
    expect(mark?.className).toContain('stmt-tested');
  });

  it('paints an untestable statement narrative regardless of links', () => {
    const statements = [
      stmt({ ordinal: 5, text: 'Background paragraph here.', testability: 'untestable', category: 'background' }),
    ];
    const { container } = render(
      <SpecDetails
        content={'## Background\n\nBackground paragraph here.\n'}
        tests={[]}
        statements={statements}
      />
    );
    const mark = container.querySelector('mark[data-ordinal="5"]');
    expect(mark?.className).toContain('stmt-narrative');
  });

  it('paints testable-without-link statements with the untested state', () => {
    const statements = [
      stmt({ ordinal: 2, text: 'Re-queues a stale task after thirty minutes.', testability: 'testable' }),
    ];
    const { container } = render(
      <SpecDetails
        content={'## A\n\nRe-queues a stale task after thirty minutes.\n'}
        tests={[]}
        statements={statements}
      />
    );
    const mark = container.querySelector('mark[data-ordinal="2"]');
    expect(mark?.className).toContain('stmt-untested');
  });

  it('falls back gracefully when a statement spans inline formatting (no mark, no throw)', () => {
    const statements = [
      stmt({ ordinal: 1, text: 'It claims a pending task before GKE.', testability: 'testable' }),
    ];
    const { container } = render(
      <SpecDetails
        content={'## A\n\nIt claims a **pending** task before GKE.\n'}
        tests={[]}
        statements={statements}
      />
    );
    expect(container.querySelector('mark[data-ordinal="1"]')).toBeNull();
  });

  it('flags list-only links (statement that did not anchor inline)', () => {
    const statements = [
      stmt({ ordinal: 1, text: 'It claims a pending task before **GKE**.', testability: 'testable' }),
    ];
    render(
      <SpecDetails
        content={'## A\n\nIt claims a pending task before **GKE**.\n'}
        tests={[testLink({ statement_ordinal: 1 })]}
        statements={statements}
      />
    );
    expect(screen.getByText('· list-only')).toBeInTheDocument();
  });

  it('flags legacy whole-spec links (statement_ordinal=null) as legacy', () => {
    render(
      <SpecDetails
        content={'## A\n\nx.\n'}
        tests={[testLink({ statement_ordinal: null, match_score: null })]}
        statements={[]}
      />
    );
    expect(screen.getByText('· legacy')).toBeInTheDocument();
  });
});
