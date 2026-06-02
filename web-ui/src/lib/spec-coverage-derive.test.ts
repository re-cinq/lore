import { describe, it, expect } from 'vitest';
import { deriveCoverageFromMarkdown } from './spec-coverage-derive';

const md = `# Feature Specification: Cov Demo

A short intro paragraph.

## Acceptance Criteria

1. Returns the expected value. ([test](src/x.test.ts#L10))
2. Throws on null.
3. Logs a warning. ([t](src/y.test.ts#L42))

## Limitations

- This is a v1 limitation that cannot be enforced.
`;

describe('deriveCoverageFromMarkdown', () => {
  it('marks the intro paragraph as narrative', () => {
    const out = deriveCoverageFromMarkdown(md);
    const intro = out.statements.find((s) => s.text.startsWith('A short intro'));
    expect(intro?.state).toBe('narrative');
    expect(intro?.category).toBe('intro');
  });

  it('marks a testable statement with a trailing test link as tested', () => {
    const out = deriveCoverageFromMarkdown(md);
    const tested = out.statements.find((s) => s.text.startsWith('Returns the expected'));
    expect(tested?.state).toBe('tested');
    expect(tested?.testLinks).toEqual([
      { label: 'test', path: 'src/x.test.ts', line: 10 },
    ]);
  });

  it('marks a testable statement WITHOUT a test link as untested', () => {
    const out = deriveCoverageFromMarkdown(md);
    const untested = out.statements.find((s) => s.text.startsWith('Throws on null'));
    expect(untested?.state).toBe('untested');
    expect(untested?.testLinks).toEqual([]);
  });

  it('marks a Limitations-section statement as narrative regardless of links', () => {
    const out = deriveCoverageFromMarkdown(md);
    const lim = out.statements.find((s) => s.text.startsWith('This is a v1 limitation'));
    expect(lim?.state).toBe('narrative');
    expect(lim?.category).toBe('limitation');
  });

  it('counts: testable = tested + untested; narrative excluded from denominator', () => {
    const out = deriveCoverageFromMarkdown(md);
    expect(out.counts).toEqual({ testable: 3, covered: 2, untestable: 2 });
  });

  it('handles empty input gracefully', () => {
    const out = deriveCoverageFromMarkdown('');
    expect(out.statements).toEqual([]);
    expect(out.counts).toEqual({ testable: 0, covered: 0, untestable: 0 });
  });
});
