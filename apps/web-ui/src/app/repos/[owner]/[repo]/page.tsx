export const dynamic = "force-dynamic";
import { getRepoChunkSummary } from "@/lib/api/chunks";
import { getRepo } from "@/lib/api/repos";
import {
  getRepoActivityCounts,
  getRepoEvents,
  getRepoSessions,
} from "@/lib/api/activity";
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

  // Mutually independent fetches in one batch; page latency = slowest call (#1030); per-call .catch keeps fail-soft.
  const [
    readme,
    repoInfo,
    recentTasks,
    latestEvents,
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
    // Latest event-bus activity (fail-soft); full infinite-scrolling list at /repos/:o/:r/events.
    getRepoEvents(fullName, 10).then((r) =>
      r.status === "ok" ? (r.data.events as unknown as RepoEvent[]) : [],
    ),
    getRepoSessions(fullName).then((r) => (r.status === "ok" ? r.data : null)),
    checkRepoFiles(fullName, [
      "AGENTS.md",
      ".github/workflows/lore-ingest.yml",
    ]).catch(() => ({
      "AGENTS.md": null,
      ".github/workflows/lore-ingest.yml": null,
    })),
    getWebhookStatus(fullName).catch(() => null),
    // Dark Factory dashboard counts (T052) — best-effort, each figure falls back to null.
    getRepoActivityCounts(fullName).then((r) =>
      r.status === "ok"
        ? r.data
        : { tasks: null, auto_merged: null, escalations: null },
    ),
  ]);

  // Webhook secret fetched (admin-scoped) only when hook needs setup by hand (pasted into GitHub, never to client).
  const webhookNeedsSetup = webhook !== null && webhook.state !== "configured";
  const [chunkSummary, webhookSecret] = await Promise.all([
    getRepoChunkSummary(fullName).then((r) =>
      r.status === "ok" ? r.data : { count: 0, convention_files: [] },
    ),
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
    chunkCount: chunkSummary.count,
    hasConventions: chunkSummary.convention_files.length > 0,
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
