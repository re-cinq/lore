export const dynamic = "force-dynamic";
import { query, queryOne, getRepoSchema } from "@/lib/db";
import { getReadme, checkRepoFiles } from "@/lib/github";
import { getWebhookStatus, getWebhookSecret } from "@/lib/webhook-api";
import { computeEnrollmentChecks } from "@/lib/enrollment";
import { reonboard, setupWebhook } from "./actions";
import RepoOverviewView, { type RecentTask } from "./RepoOverviewView";
import { type RepoEvent } from "./events/pagination";

export default async function RepoOverview({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo: repoName } = await params;
  const fullName = `${owner}/${repoName}`;

  // Everything below is mutually independent — fetch in one batch so page
  // latency tracks the slowest call, not the sum (#1030). Per-call .catch
  // fallbacks keep the original fail-soft semantics: memory.episodes and
  // pipeline.audit_log may not exist on legacy clusters, GitHub/webhook
  // lookups fail soft to null.
  const [
    readme,
    repoInfo,
    recentTasks,
    latestEvents,
    schema,
    localMcpRow,
    githubFiles,
    webhook,
    darkTasksRow,
    autoMergedRow,
    escalationsRow,
  ] = await Promise.all([
    getReadme(fullName).catch(() => null),
    queryOne<{
      settings?: {
        dark_factory?: { enabled?: boolean };
        trust?: { level?: string };
      };
      onboarded_at: string;
      last_ingested_at?: string;
      team?: string;
      onboarding_pr_url?: string;
      onboarding_pr_merged?: boolean;
    }>(
      `SELECT settings, onboarded_at, last_ingested_at, team,
              onboarding_pr_url, onboarding_pr_merged
       FROM lore.repos WHERE full_name = $1`,
      [fullName],
    ),
    query(
      `SELECT id, description, status, agent_id, pr_url, created_at
       FROM pipeline.tasks WHERE target_repo = $1 ORDER BY created_at DESC LIMIT 5`,
      [fullName],
    ),
    // Latest event-bus activity for this repo (fail-soft — repo is a first-class
    // column since migration 0024, so only github.* / internal.* events match; the
    // full, infinite-scrolling list lives at /repos/:o/:r/events).
    query<RepoEvent>(
      `SELECT id, event_name, source, params, status, captured_at
       FROM pipeline.events WHERE repo = $1
       ORDER BY captured_at DESC LIMIT 10`,
      [fullName],
    ).catch(() => []),
    getRepoSchema(fullName),
    queryOne<{ devs: number; last: string | Date | null }>(
      `SELECT count(DISTINCT agent_id)::int AS devs, max(created_at) AS last
         FROM memory.episodes WHERE source = 'session' AND ref = $1`,
      [fullName],
    ).catch(() => null),
    checkRepoFiles(fullName, [
      "AGENTS.md",
      ".github/workflows/lore-ingest.yml",
    ]).catch(() => ({
      "AGENTS.md": null,
      ".github/workflows/lore-ingest.yml": null,
    })),
    getWebhookStatus(fullName).catch(() => null),
    // Dark Factory dashboard counts (T052) — best-effort, each falls back to
    // null on DB error so the panel never breaks the page.
    queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.tasks
        WHERE target_repo = $1 AND created_at >= now() - interval '7 days'`,
      [fullName],
    ).catch(() => null),
    queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.audit_log
        WHERE repo = $1
          AND event_type = 'auto_merge_decision'
          AND payload->>'outcome' = 'merged'
          AND created_at >= now() - interval '7 days'`,
      [fullName],
    ).catch(() => null),
    queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.audit_log
        WHERE repo = $1
          AND event_type = 'escalation_issued'
          AND created_at >= now() - interval '7 days'`,
      [fullName],
    ).catch(() => null),
  ]);

  // Second batch: the chunk queries need the resolved schema, and the webhook
  // secret is fetched (admin-scoped) only when the hook needs setting up by
  // hand — revealed so it can be pasted into GitHub alongside the URL, never
  // reaching the client for an already-wired repo.
  const [contextCount, conventionRows, webhookSecret] = await Promise.all([
    queryOne<{ count: number }>(
      `SELECT count(*)::int as count FROM ${schema}.chunks WHERE repo = $1`,
      [fullName],
    ).catch(() => null),
    query<{ file_path: string }>(
      `SELECT DISTINCT file_path FROM ${schema}.chunks WHERE repo = $1 AND file_path IN ('AGENTS.md','CLAUDE.md')`,
      [fullName],
    ).catch(() => []),
    webhook && webhook.state !== "configured"
      ? getWebhookSecret(fullName).catch(() => null)
      : Promise.resolve(null),
  ]);

  // pg returns TIMESTAMPTZ columns as Date objects — normalize to ISO strings.
  const iso = (d: unknown): string | null =>
    d ? new Date(d as string | Date).toISOString() : null;

  const localMcp = {
    developerCount: localMcpRow?.devs ?? 0,
    lastActivity: iso(localMcpRow?.last),
  };
  const webhookWithSecret =
    webhook && webhook.state !== "configured"
      ? { ...webhook, secret: webhookSecret ?? undefined }
      : webhook;

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
    webhook: webhookWithSecret,
    localMcp,
  });

  const darkFactoryEnabled = repoInfo?.settings?.dark_factory?.enabled === true;
  const trustLevel = repoInfo?.settings?.trust?.level ?? "unset";
  const darkTasksWeek = darkTasksRow?.c ?? 0;
  const autoMergedWeek = autoMergedRow?.c ?? 0;
  const escalationsWeek = escalationsRow?.c ?? 0;

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
      recentTasks={recentTasks as unknown as RecentTask[]}
      latestEvents={latestEvents}
      reonboardAction={reonboard.bind(null, fullName)}
      setupWebhookAction={setupWebhook.bind(null, fullName)}
    />
  );
}
