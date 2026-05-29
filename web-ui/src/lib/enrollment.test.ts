import { describe, it, expect } from 'vitest';
import { computeEnrollmentChecks, passSummary, type EnrollmentInput } from './enrollment';

const NOW = new Date('2026-05-29T12:00:00Z').getTime();
const daysBefore = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function input(overrides: Partial<EnrollmentInput> = {}): EnrollmentInput {
  return {
    onboarded: true,
    onboardedAt: daysBefore(60),
    onboardingPrMerged: true,
    onboardingPrUrl: 'https://github.com/re-cinq/x/pull/1',
    lastIngestedAt: daysBefore(1),
    chunkCount: 41,
    hasConventions: true,
    team: 'platform',
    githubFiles: { 'AGENTS.md': true, '.github/workflows/lore-ingest.yml': true },
    localMcp: { developerCount: 2, lastActivity: daysBefore(1) },
    now: NOW,
    ...overrides,
  };
}

const byId = (checks: ReturnType<typeof computeEnrollmentChecks>, id: string) =>
  checks.find(c => c.id === id)!;

describe('computeEnrollmentChecks', () => {
  it('onboarded passes with the onboarded date when registered', () => {
    expect(byId(computeEnrollmentChecks(input({ onboardedAt: '2026-03-30T10:00:00Z' })), 'onboarded'))
      .toMatchObject({ status: 'pass', detail: 'since 2026-03-30' });
  });

  it('onboarded fails when not registered', () => {
    expect(byId(computeEnrollmentChecks(input({ onboarded: false })), 'onboarded').status).toBe('fail');
  });

  it('onboarding PR warns with a merge link when open', () => {
    const c = byId(computeEnrollmentChecks(input({ onboardingPrMerged: false })), 'onboarding-pr');
    expect(c).toMatchObject({ status: 'warn', link: { href: 'https://github.com/re-cinq/x/pull/1' } });
  });

  it('onboarding PR check is omitted when there is no PR url', () => {
    const checks = computeEnrollmentChecks(input({ onboardingPrUrl: null }));
    expect(checks.find(c => c.id === 'onboarding-pr')).toBeUndefined();
  });

  it('context ingested fails when never ingested', () => {
    expect(byId(computeEnrollmentChecks(input({ lastIngestedAt: null })), 'ingested'))
      .toMatchObject({ status: 'fail', detail: 'never ingested' });
  });

  it('context ingested warns when older than 7 days', () => {
    expect(byId(computeEnrollmentChecks(input({ lastIngestedAt: daysBefore(12) })), 'ingested').status).toBe('warn');
  });

  it('context ingested passes when fresh', () => {
    expect(byId(computeEnrollmentChecks(input({ lastIngestedAt: daysBefore(2) })), 'ingested').status).toBe('pass');
  });

  it('conventions fails when neither AGENTS.md nor CLAUDE.md is ingested', () => {
    expect(byId(computeEnrollmentChecks(input({ hasConventions: false })), 'conventions').status).toBe('fail');
  });

  it('team warns and notes org_shared when unassigned', () => {
    expect(byId(computeEnrollmentChecks(input({ team: null })), 'team'))
      .toMatchObject({ status: 'warn', detail: 'using org_shared' });
  });

  it('github file is pass / fail / unknown for true / false / null', () => {
    const checks = computeEnrollmentChecks(input({
      githubFiles: { 'AGENTS.md': true, 'CLAUDE.md': false, '.github/workflows/lore-ingest.yml': null },
    }));
    expect(byId(checks, 'gh:AGENTS.md').status).toBe('pass');
    expect(byId(checks, 'gh:CLAUDE.md').status).toBe('fail');
    expect(byId(checks, 'gh:.github/workflows/lore-ingest.yml')).toMatchObject({
      status: 'unknown',
      detail: 'GitHub App has no repo access',
    });
  });

  it('local MCP passes with developer count when sessions exist', () => {
    expect(byId(computeEnrollmentChecks(input({ localMcp: { developerCount: 1, lastActivity: daysBefore(3) } })), 'local-mcp'))
      .toMatchObject({ status: 'pass', detail: '1 developer · last 3d ago' });
  });

  it('local MCP fails when no sessions recorded', () => {
    expect(byId(computeEnrollmentChecks(input({ localMcp: { developerCount: 0, lastActivity: null } })), 'local-mcp'))
      .toMatchObject({ status: 'fail', detail: 'no local Claude Code sessions yet' });
  });

  it('passSummary counts passing over total', () => {
    expect(passSummary(computeEnrollmentChecks(input()))).toEqual({ passed: 8, total: 8 });
  });
});
