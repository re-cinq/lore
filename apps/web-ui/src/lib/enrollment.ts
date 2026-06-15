export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  link?: { href: string; text: string };
  /** A fixable check the UI can act on directly (e.g. open a PR with the file). */
  action?: { kind: 'reonboard'; text: string };
}

export interface EnrollmentInput {
  onboarded: boolean;
  onboardedAt: string | null;
  onboardingPrMerged: boolean;
  onboardingPrUrl: string | null;
  lastIngestedAt: string | null;
  chunkCount: number;
  hasConventions: boolean;
  team: string | null;
  /** path -> exists (true/false) or null when unknown (App not configured / no access) */
  githubFiles: Record<string, boolean | null>;
  localMcp: { developerCount: number; lastActivity: string | null };
  now: number;
}

const STALE_MS = 7 * 86_400_000;

const GH_FILE_PURPOSE: Record<string, string> = {
  'AGENTS.md': 'context-loading order & conventions for AI agents',
  '.github/workflows/lore-ingest.yml': 'push-triggered context ingestion — keeps Lore fresh on every push',
};

function daysAgo(now: number, iso: string): string {
  const d = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'today' : `${d}d ago`;
}

export function computeEnrollmentChecks(input: EnrollmentInput): Check[] {
  const checks: Check[] = [];

  checks.push({
    id: 'onboarded',
    label: 'Onboarded',
    status: input.onboarded ? 'pass' : 'fail',
    detail: input.onboarded
      ? input.onboardedAt
        ? `since ${input.onboardedAt.slice(0, 10)}`
        : 'registered in Lore'
      : 'repo not registered',
  });

  if (input.onboardingPrUrl) {
    checks.push({
      id: 'onboarding-pr',
      label: 'Onboarding PR merged',
      status: input.onboardingPrMerged ? 'pass' : 'warn',
      detail: input.onboardingPrMerged ? undefined : 'open',
      link: input.onboardingPrMerged
        ? undefined
        : { href: input.onboardingPrUrl, text: 'review & merge' },
    });
  }

  if (!input.lastIngestedAt) {
    checks.push({ id: 'ingested', label: 'Context ingested', status: 'fail', detail: 'never ingested' });
  } else {
    const stale = input.now - new Date(input.lastIngestedAt).getTime() > STALE_MS;
    const when = daysAgo(input.now, input.lastIngestedAt);
    checks.push({
      id: 'ingested',
      label: 'Context ingested',
      status: stale ? 'warn' : 'pass',
      detail: `${stale ? 'stale · ' : ''}${input.chunkCount} chunks · last ingest ${when}`,
    });
  }

  checks.push({
    id: 'conventions',
    label: 'Conventions ingested',
    status: input.hasConventions ? 'pass' : 'fail',
    detail: input.hasConventions ? undefined : 'AGENTS.md / CLAUDE.md not in context',
  });

  checks.push({
    id: 'team',
    label: 'Team assigned',
    status: input.team ? 'pass' : 'warn',
    detail: input.team ?? 'using org_shared',
  });

  for (const [path, exists] of Object.entries(input.githubFiles)) {
    const status: CheckStatus = exists === true ? 'pass' : exists === false ? 'fail' : 'unknown';
    const purpose = GH_FILE_PURPOSE[path];
    const check: Check = { id: `gh:${path}`, label: `${path} on GitHub`, status };
    if (status === 'unknown') {
      check.detail = 'GitHub App has no repo access';
    } else if (status === 'fail') {
      check.detail = purpose ? `missing · ${purpose}` : 'missing';
      check.action = { kind: 'reonboard', text: 'create a PR with this file' };
    } else if (purpose) {
      check.detail = purpose;
    }
    checks.push(check);
  }

  const { developerCount, lastActivity } = input.localMcp;
  checks.push({
    id: 'local-mcp',
    label: 'Used locally via MCP',
    status: developerCount > 0 ? 'pass' : 'fail',
    detail:
      developerCount > 0
        ? `${developerCount} developer${developerCount === 1 ? '' : 's'}${lastActivity ? ` · last ${daysAgo(input.now, lastActivity)}` : ''}`
        : 'no local Claude Code sessions yet',
  });

  return checks;
}

export function passSummary(checks: Check[]): { passed: number; total: number } {
  return { passed: checks.filter(c => c.status === 'pass').length, total: checks.length };
}
