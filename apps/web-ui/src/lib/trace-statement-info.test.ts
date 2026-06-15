import { describe, it, expect } from 'vitest';
import { toStatementInfo } from './trace-statement-info';
import type { StatementInfo } from '@/app/repos/[owner]/[repo]/specs/SpecDetails';

interface GraphStatement {
  ordinal: number;
  text: string;
  kind?: string;
  testability?: string;
  state: 'tested' | 'untested' | 'narrative';
  links: Array<{
    kind: 'test' | 'code' | 'adr';
    label: string;
    path?: string;
    line?: number;
    detail?: string;
  }>;
  drifted?: boolean;
  violated?: boolean;
}

describe('toStatementInfo', () => {
  it('maps ordinal, text, kind, and state straight through for an untested sentence', () => {
    const statements: GraphStatement[] = [
      { ordinal: 3, text: 'Token rotates hourly.', kind: 'sentence', state: 'untested', links: [] },
    ];

    const result: StatementInfo[] = toStatementInfo(statements);

    expect(result[0]).toMatchObject({
      ordinal: 3,
      text: 'Token rotates hourly.',
      kind: 'sentence',
      state: 'untested',
    });
  });

  it('maps only the test-kind links into testLinks (excluding code/adr links)', () => {
    const statements: GraphStatement[] = [
      {
        ordinal: 1,
        text: 'Token rotates hourly.',
        state: 'tested',
        links: [
          { kind: 'test', label: 'rotate.test.ts', path: 'auth/rotate.test.ts', line: 12 },
          { kind: 'code', label: 'rotate', path: 'src/auth.ts', line: 40 },
          { kind: 'adr', label: 'ADR-16', path: 'adrs/ADR-016.md' },
        ],
      },
    ];

    const result: StatementInfo[] = toStatementInfo(statements);

    expect(result[0].testLinks).toEqual([
      { label: 'rotate.test.ts', path: 'auth/rotate.test.ts', line: 12 },
    ]);
  });

  it('sets drifted true when the statement is violated even if drifted is unset', () => {
    const statements: GraphStatement[] = [
      { ordinal: 1, text: 'x', state: 'tested', links: [], violated: true },
    ];

    const result: StatementInfo[] = toStatementInfo(statements);

    expect(result[0].drifted).toBe(true);
  });
});
