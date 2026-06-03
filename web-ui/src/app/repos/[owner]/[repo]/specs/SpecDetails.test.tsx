// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpecDetails, { type StatementInfo } from './SpecDetails';

const stmt = (overrides: Partial<StatementInfo> = {}): StatementInfo => ({
  ordinal: 0,
  text: 'Default text.',
  kind: 'sentence',
  state: 'untested',
  category: null,
  testLinks: [],
  ...overrides,
});

describe('SpecDetails v3 (markdown-driven)', () => {
  it('wraps a statement that carries a test link in the trailing paren with stmt-tested', () => {
    const md = '## Acceptance Criteria\n\n- Claims a pending task. ([t](src/x.test.ts#L1))\n';
    const statements = [
      stmt({
        ordinal: 0,
        text: 'Claims a pending task. ([t](src/x.test.ts#L1))',
        kind: 'list-item',
        state: 'tested',
        testLinks: [{ label: 't', path: 'src/x.test.ts', line: 1 }],
      }),
    ];
    const { container } = render(<SpecDetails content={md} statements={statements} />);
    const mark = container.querySelector('mark[data-state="tested"]');
    expect(mark).not.toBeNull();
    expect(mark?.className).toContain('stmt-tested');
  });

  it('wraps an unlinked testable statement with stmt-untested (red)', () => {
    const md = '## Acceptance Criteria\n\n- Re-queues a stale task.\n';
    const statements = [
      stmt({
        ordinal: 0,
        text: 'Re-queues a stale task.',
        kind: 'list-item',
        state: 'untested',
      }),
    ];
    const { container } = render(<SpecDetails content={md} statements={statements} />);
    const mark = container.querySelector('mark[data-state="untested"]');
    expect(mark?.className).toContain('stmt-untested');
  });

  it('wraps a narrative-section statement with stmt-narrative (grey)', () => {
    const md = '## Limitations\n\n- Cannot be enforced.\n';
    const statements = [
      stmt({
        ordinal: 0,
        text: 'Cannot be enforced.',
        kind: 'list-item',
        state: 'narrative',
        category: 'limitation',
      }),
    ];
    const { container } = render(<SpecDetails content={md} statements={statements} />);
    expect(container.querySelector('mark[data-state="narrative"]')).not.toBeNull();
  });

  it('does NOT decorate regular non-test links the author writes outside test parens', () => {
    const md = '## A\n\nPer [ADR-015](adrs/ADR-015.md). ([t](src/x.test.ts#L1))\n';
    const statements = [
      stmt({
        ordinal: 0,
        text: 'Per [ADR-015](adrs/ADR-015.md). ([t](src/x.test.ts#L1))',
        state: 'tested',
        testLinks: [{ label: 't', path: 'src/x.test.ts', line: 1 }],
      }),
    ];
    const { container } = render(<SpecDetails content={md} statements={statements} />);
    const adrLink = container.querySelector('a[href="adrs/ADR-015.md"]');
    expect(adrLink?.className ?? '').not.toContain('stmt-test-link');
    const testLink = container.querySelector('a[href="src/x.test.ts#L1"]');
    expect(testLink).not.toBeNull();
  });

  it('does NOT render the legacy tests[] list, the legacy TestLink prop, or list-only/legacy badges', () => {
    const md = '## A\n\n- Plain.\n';
    const statements = [stmt({ ordinal: 0, text: 'Plain.', state: 'untested' })];
    render(<SpecDetails content={md} statements={statements} />);
    expect(screen.queryByText(/Tests validating this spec/)).toBeNull();
    expect(screen.queryByText(/list-only/)).toBeNull();
    expect(screen.queryByText(/legacy/)).toBeNull();
  });

  it('wraps a statement that spans inline bold formatting with stmt-tested', () => {
    const md = '## A\n\n- It claims a **pending** task. ([t](src/x.test.ts#L1))\n';
    const statements = [
      stmt({
        ordinal: 0,
        text: 'It claims a **pending** task. ([t](src/x.test.ts#L1))',
        state: 'tested',
        testLinks: [{ label: 't', path: 'src/x.test.ts', line: 1 }],
      }),
    ];
    const { container } = render(<SpecDetails content={md} statements={statements} />);
    const mark = container.querySelector('mark[data-state="tested"]');
    expect(mark?.className).toContain('stmt-tested');
    expect(container.querySelector('a[href="src/x.test.ts#L1"]')).not.toBeNull();
  });

  it('wraps a statement containing inline code (backticks) with stmt-tested', () => {
    const md =
      '## Acceptance Criteria\n\n- A statement carrying a test link counts as `covered` in the `CoverageBar`. ([t](src/x.test.ts#L1))\n';
    const statements = [
      stmt({
        ordinal: 0,
        text: 'A statement carrying a test link counts as `covered` in the `CoverageBar`. ([t](src/x.test.ts#L1))',
        kind: 'list-item',
        state: 'tested',
        testLinks: [{ label: 't', path: 'src/x.test.ts', line: 1 }],
      }),
    ];
    const { container } = render(<SpecDetails content={md} statements={statements} />);
    const mark = container.querySelector('mark[data-state="tested"]');
    expect(mark?.className).toContain('stmt-tested');
    expect(mark?.getAttribute('data-ordinal')).toEqual('0');
    expect(container.querySelector('code')?.textContent).toEqual('covered');
  });

  it('keeps the highlight on re-render (matcher state is not stale across transforms)', () => {
    const md =
      '## Acceptance Criteria\n\n- A statement carrying a test link counts as `covered`. ([t](src/x.test.ts#L1))\n';
    const statements = [
      stmt({
        ordinal: 0,
        text: 'A statement carrying a test link counts as `covered`. ([t](src/x.test.ts#L1))',
        kind: 'list-item',
        state: 'tested',
        testLinks: [{ label: 't', path: 'src/x.test.ts', line: 1 }],
      }),
    ];
    const { container, rerender } = render(<SpecDetails content={md} statements={statements} />);
    expect(container.querySelector('mark[data-state="tested"]')).not.toBeNull();
    rerender(<SpecDetails content={md} statements={statements} />);
    expect(container.querySelector('mark[data-state="tested"]')).not.toBeNull();
  });

  it('wraps a code-span statement whose backticks contain literal link/emphasis syntax', () => {
    const md =
      '## Acceptance Criteria\n\n- The cron emits a `([validated by ...](path#Lline))` parenthetical. ([t](src/x.test.ts#L1))\n';
    const statements = [
      stmt({
        ordinal: 0,
        text: 'The cron emits a `([validated by ...](path#Lline))` parenthetical. ([t](src/x.test.ts#L1))',
        kind: 'list-item',
        state: 'tested',
        testLinks: [{ label: 't', path: 'src/x.test.ts', line: 1 }],
      }),
    ];
    const { container } = render(<SpecDetails content={md} statements={statements} />);
    expect(container.querySelector('mark[data-state="tested"]')?.className).toContain('stmt-tested');
  });
});
