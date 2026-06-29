export const dynamic = "force-dynamic";
import { query, queryOne, getRepoSchema } from '@/lib/db';
import { getReadme, checkRepoFiles } from '@/lib/github';
import { getWebhookStatus } from '@/lib/webhook-api';
import { computeEnrollmentChecks } from '@/lib/enrollment';
import { reonboard, setupWebhook } from './actions';
import RepoOverviewView, { type RecentTask } from './RepoOverviewView';

export default async function RepoOverview({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo: repoName } = await params;
  const fullName = `${owner}/${repoName}`;
  const readme = await getReadme(fullName).catch(() => null);

  const repoInfo = await queryOne<{
    settings?: { dark_factory?: { enabled?: boolean }; trust?: { level?: string } };
    onboarded_at: string;
    last_ingested_at?: string;
    team?: string;
    onboarding_pr_url?: string;
    onboarding_pr_merged?: boolean;
  }>(`SELECT * FROM lore.repos WHERE full_name = $1`, [fullName]);
  const recentTasks = await query(
    `SELECT id, description, status, agent_id, pr_url, created_at
     FROM pipeline.tasks WHERE target_repo = $1 ORDER BY created_at DESC LIMIT 5`,
    [fullName]
  );
  const schema = await getRepoSchema(fullName);
  const contextCount = await queryOne<{count: number}>(
    `SELECT count(*)::int as count FROM ${schema}.chunks WHERE repo = $1`,
    [fullName]
  ).catch(() => null);

  // Enrollment / integration signals (all fail-soft).
  const conventionRows = await query<{ file_path: string }>(
    `SELECT DISTINCT file_path FROM ${schema}.chunks WHERE repo = $1 AND file_path IN ('AGENTS.md','CLAUDE.md')`,
    [fullName],
  ).catch(() => []);
  // pg returns TIMESTAMPTZ columns as Date objects — normalize to ISO strings.
  const iso = (d: unknown): string | null => (d ? new Date(d as string | Date).toISOString() : null);
  let localMcp = { developerCount: 0, lastActivity: null as string | null };
  try {
    const row = await queryOne<{ devs: number; last: string | Date | null }>(
      `SELECT count(DISTINCT agent_id)::int AS devs, max(created_at) AS last
         FROM memory.episodes WHERE source = 'session' AND ref = $1`,
      [fullName],
    );
    localMcp = { developerCount: row?.devs ?? 0, lastActivity: iso(row?.last) };
  } catch {
    // memory.episodes may not exist on legacy clusters.
  }
  const githubFiles = await checkRepoFiles(fullName, ['AGENTS.md', '.github/workflows/lore-ingest.yml']).catch(
    () => ({ 'AGENTS.md': null, '.github/workflows/lore-ingest.yml': null }),
  );
  const webhook = await getWebhookStatus(fullName).catch(() => null);

  const enrollmentChecks = computeEnrollmentChecks({
    onboarded: !!repoInfo,
    onboardedAt: iso(repoInfo?.onboarded_at),
    onboardingPrMerged: repoInfo?.onboarding_pr_merged === true,
    onboardingPrUrl: repoInfo?.onboarding_pr_url ?? null,
    lastIngestedAt: iso(repoInfo?.last_ingested_at),
    chunkCount: contextCount?.count ?? 0,
    hasConventions: conventionRows.length > 0,
    team: repoInfo?.team ?? null,
    githubFiles,
    webhook,
    localMcp,
    now: Date.now(),
  });

  // Dark Factory dashboard counts (T052) — best-effort, falls back to
  // zero on any DB error so the panel never breaks the page.
  const darkFactoryEnabled = repoInfo?.settings?.dark_factory?.enabled === true;
  const trustLevel = repoInfo?.settings?.trust?.level ?? "unset";
  let darkTasksWeek = 0;
  let autoMergedWeek = 0;
  let escalationsWeek = 0;
  try {
    const dt = await queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.tasks
        WHERE target_repo = $1 AND created_at >= now() - interval '7 days'`,
      [fullName],
    );
    darkTasksWeek = dt?.c ?? 0;
    const am = await queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.audit_log
        WHERE repo = $1
          AND event_type = 'auto_merge_decision'
          AND payload->>'outcome' = 'merged'
          AND created_at >= now() - interval '7 days'`,
      [fullName],
    );
    autoMergedWeek = am?.c ?? 0;
    const es = await queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.audit_log
        WHERE repo = $1
          AND event_type = 'escalation_issued'
          AND created_at >= now() - interval '7 days'`,
      [fullName],
    );
    escalationsWeek = es?.c ?? 0;
  } catch {
    // pipeline.audit_log may not exist yet on legacy clusters.
  }

  return (
    <RepoOverviewView
      owner={owner}
      repo={repoName}
      readme={readme}
      enrollmentChecks={enrollmentChecks}
      darkFactoryEnabled={darkFactoryEnabled}
      trustLevel={trustLevel}
      darkTasksWeek={darkTasksWeek}
      autoMergedWeek={autoMergedWeek}
      escalationsWeek={escalationsWeek}
      recentTasks={recentTasks as RecentTask[]}
      reonboardAction={reonboard.bind(null, fullName)}
      setupWebhookAction={setupWebhook.bind(null, fullName)}
    />
  );
}
