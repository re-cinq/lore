export const dynamic = "force-dynamic";
import { query, queryOne, getRepoSchema } from "@/lib/db";
import { getRepo } from "@/lib/api/repos";
import { getRepoActivityCounts } from "@/lib/api/activity";
import { getRepoTasks } from "@/lib/api/tasks";
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
    activityCounts,
  ] = await Promise.all([
    getReadme(fullName).catch(() => null),
    getRepo(fullName).then((result) =>
      result.status === "ok" ? result.data : null,
    ),
    getRepoTasks(fullName, 5).then((r) =>
      r.status === "ok" ? r.data.tasks : [],
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
    // Dark Factory dashboard counts (T052) — best-effort, each figure falls back
    // to null so the panel never breaks the page.
    getRepoActivityCounts(fullName).then((r) =>
      r.status === "ok"
        ? r.data
        : { tasks: null, auto_merged: null, escalations: null },
    ),
  ]);

  // Second batch: the chunk queries need the resolved schema, and the webhook
  // secret is fetched (admin-scoped) only when the hook needs setting up by
  // hand — revealed so it can be pasted into GitHub alongside the URL, never
  // reaching the client for an already-wired repo.
  const webhookNeedsSetup = webhook !== null && webhook.state !== "configured";
  const [contextCount, conventionRows, webhookSecret] = await Promise.all([
    queryOne<{ count: number }>(
      `SELECT count(*)::int as count FROM ${schema}.chunks WHERE repo = $1`,
      [fullName],
    ).catch(() => null),
    query<{ file_path: string }>(
      `SELECT DISTINCT file_path FROM ${schema}.chunks WHERE repo = $1 AND file_path IN ('AGENTS.md','CLAUDE.md')`,
      [fullName],
    ).catch(() => []),
    webhookNeedsSetup
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
  const webhookWithSecret = webhookNeedsSetup
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

  // The record carries settings as opaque JSONB; this page reads two keys of it.
  const repoSettings = (repoInfo?.settings ?? {}) as {
    dark_factory?: { enabled?: boolean };
    trust?: { level?: string };
  };
  const darkFactoryEnabled = repoSettings.dark_factory?.enabled === true;
  const trustLevel = repoSettings.trust?.level ?? "unset";
  const darkTasksWeek = activityCounts.tasks ?? 0;
  const autoMergedWeek = activityCounts.auto_merged ?? 0;
  const escalationsWeek = activityCounts.escalations ?? 0;

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
