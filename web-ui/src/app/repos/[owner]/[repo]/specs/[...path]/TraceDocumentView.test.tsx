// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TraceDocumentView, { type TraceDocument } from './TraceDocumentView';

const doc: TraceDocument = {
  filePath: 'specs/auth/spec.md',
  coverage: { testable: 2, covered: 1, untestable: 1, ratio: 0.5 },
  sections: [{ uid: 's1', heading: 'Goals', ordinal: 1, level: 2 }],
  statements: [
    {
      uid: 'a',
      ordinal: 1,
      text: 'Token rotates hourly',
      state: 'tested',
      sectionUid: 's1',
      links: [{ kind: 'test', label: 'rotate.test.ts', path: 'auth/rotate.test.ts', line: 12, detail: 'rotates' }],
    },
    { uid: 'b', ordinal: 2, text: 'Narrative note', state: 'narrative', sectionUid: 's1', links: [] },
  ],
};

describe('TraceDocumentView', () => {
  it('renders coverage summary, section heading, statements by state, and link chips', () => {
    const { container } = render(<TraceDocumentView repo="re-cinq/lore" doc={doc} />);

    expect(screen.getByText('Goals')).toBeTruthy();
    expect(screen.getByText(/Token rotates hourly/)).toBeTruthy();
    expect(screen.getByText(/1\s*\/\s*2/)).toBeTruthy();
    expect(container.querySelector('[data-state="tested"]')).not.toBeNull();
    expect(container.querySelector('[data-state="narrative"]')).not.toBeNull();
    expect(screen.getByText('rotate.test.ts')).toBeTruthy();
  });

  it('renders statements with no section under an ungrouped fallback and links to test/code/adr targets', () => {
    const ungrouped: TraceDocument = {
      filePath: 'specs/x/spec.md',
      coverage: { testable: 1, covered: 1, untestable: 0, ratio: 1 },
      sections: [],
      statements: [
        {
          uid: 'a',
          ordinal: 1,
          text: 'Implemented and decided',
          state: 'tested',
          links: [
            { kind: 'code', label: 'rotate', path: 'src/auth.ts', line: 40 },
            { kind: 'adr', label: 'ADR-16', path: 'adrs/ADR-016-dark.md' },
          ],
        },
      ],
    };
    render(<TraceDocumentView repo="re-cinq/lore" doc={ungrouped} />);
    expect(screen.getByText('rotate')).toBeTruthy();
    expect(screen.getByText('ADR-16')).toBeTruthy();
  });

  it('shows drift/violation flags and renders a pathless link as plain text', () => {
    const flagged: TraceDocument = {
      filePath: 'specs/x/spec.md',
      coverage: { testable: 1, covered: 0, untestable: 0, ratio: 0 },
      sections: [],
      statements: [
        {
          uid: 'a',
          ordinal: 1,
          text: 'Drifted and violated',
          state: 'untested',
          drifted: true,
          violated: true,
          links: [{ kind: 'test', label: 'orphan-test' }],
        },
      ],
    };
    const { container } = render(<TraceDocumentView repo="re-cinq/lore" doc={flagged} />);
    expect(container.querySelector('[data-drifted="true"]')).not.toBeNull();
    expect(container.querySelector('[data-violated="true"]')).not.toBeNull();
    expect(screen.getByText('orphan-test')).toBeTruthy();
  });
});
