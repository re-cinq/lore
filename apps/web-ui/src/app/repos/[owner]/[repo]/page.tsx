export const dynamic = "force-dynamic";
import { getRepoChunkSummary } from "@/lib/api/chunks";
import {
  enrollmentFromRepo,
  isoTimestamp,
  needsWebhookSecret,
  overviewSettings,
} from "@/lib/repo-overview";
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

interface RepoOverviewProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepoOverview(props: RepoOverviewProps) {
  const { owner, repo: repoName } = await props.params;
  const fullName = `${owner}/${repoName}`;
  const page = await loadRepoOverview(fullName);

  return (
    <RepoOverviewView
      owner={owner}
      repo={repoName}
      {...page}
      reonboardAction={reonboard.bind(null, fullName)}
      setupWebhookAction={setupWebhook.bind(null, fullName)}
    />
  );
}

type OverviewPanels = Awaited<ReturnType<typeof fetchOverviewPanels>>;

/** Everything the overview renders, fetched fail-soft. A failed call costs its own panel, never the page. */
async function loadRepoOverview(fullName: string) {
  const panels = await fetchOverviewPanels(fullName);
  const [chunkSummary, webhook] = await Promise.all([
    getRepoChunkSummary(fullName).then((r) =>
      r.status === "ok" ? r.data : { count: 0, convention_files: [] },
    ),
    withWebhookSecret(fullName, panels.webhook),
  ]);
  const settings = overviewSettings(panels.repoInfo?.settings);

  return {
    readme: panels.readme,
    enrollmentChecks: buildEnrollmentChecks(panels, chunkSummary, webhook),
    darkFactoryEnabled: settings.darkFactoryEnabled,
    trustLevel: settings.trustLevel,
    ...weeklyCounts(panels.activityCounts),
    recentTasks: panels.recentTasks as unknown as RecentTask[],
    latestEvents: panels.latestEvents,
  };
}

function buildEnrollmentChecks(
  panels: OverviewPanels,
  chunkSummary: { count: number; convention_files: string[] },
  webhook: Awaited<ReturnType<typeof withWebhookSecret>>,
) {
  return computeEnrollmentChecks({
    ...enrollmentFromRepo(panels.repoInfo),
    chunkCount: chunkSummary.count,
    hasConventions: chunkSummary.convention_files.length > 0,
    githubFiles: panels.githubFiles,
    webhook,
    localMcp: {
      developerCount: panels.localMcpRow?.devs ?? 0,
      lastActivity: isoTimestamp(panels.localMcpRow?.last),
    },
  });
}

// Dark Factory dashboard counts (T052) — a figure that failed to load reads as zero, not as a gap.
function weeklyCounts(activityCounts: OverviewPanels["activityCounts"]) {
  return {
    darkTasksWeek: activityCounts.tasks ?? 0,
    autoMergedWeek: activityCounts.auto_merged ?? 0,
    escalationsWeek: activityCounts.escalations ?? 0,
  };
}

/** The secret is admin-scoped and fetched only for a hook that still needs setting up by hand — it is pasted into GitHub, never sent to a client. */
async function withWebhookSecret(
  fullName: string,
  webhook: Awaited<ReturnType<typeof getWebhookStatus>> | null,
) {
  if (!needsWebhookSecret(webhook)) {
    return webhook;
  }
  const secret = await getWebhookSecret(fullName).catch(() => null);

  return { ...webhook, secret: secret ?? undefined };
}

/** The eight panel reads, all fail-soft and all in one batch: page latency is the slowest call, not their sum (#1030). Both halves are started before either is awaited, so splitting them costs no round trip. */
async function fetchOverviewPanels(fullName: string) {
  const [repoPanels, integrationPanels] = await Promise.all([
    fetchRepoPanels(fullName),
    fetchIntegrationPanels(fullName),
  ]);

  return { ...repoPanels, ...integrationPanels };
}

/** What the repo itself says: its README, its record, its recent work. Every read is fail-soft — a panel that cannot load renders empty rather than taking the page down with it. */
async function fetchRepoPanels(fullName: string) {
  const [readme, repoInfo, recentTasks, latestEvents] = await Promise.all([
    getReadme(fullName).catch(() => null),
    getRepo(fullName).then((result) =>
      result.status === "ok" ? result.data : null,
    ),
    getRepoTasks(fullName, 5).then((r) =>
      r.status === "ok" ? r.data.tasks : [],
    ),
    // Latest event-bus activity; the full infinite-scrolling list is at /repos/:o/:r/events.
    getRepoEvents(fullName, 10).then((r) =>
      r.status === "ok" ? (r.data.events as unknown as RepoEvent[]) : [],
    ),
  ]);

  return { readme, repoInfo, recentTasks, latestEvents };
}

/** How well the repo is wired into Lore: its session, its onboarding files, its webhook, its dark-factory counters. Fail-soft in the same way, and each figure falls back to null rather than to zero — "not known" is not "none". */
async function fetchIntegrationPanels(fullName: string) {
  const [localMcpRow, githubFiles, webhook, activityCounts] = await Promise.all(
    [
      getRepoSessions(fullName).then((r) =>
        r.status === "ok" ? r.data : null,
      ),
      fetchOnboardingFiles(fullName),
      getWebhookStatus(fullName).catch(() => null),
      getRepoActivityCounts(fullName).then((r) =>
        r.status === "ok"
          ? r.data
          : { tasks: null, auto_merged: null, escalations: null },
      ),
    ],
  );

  return { localMcpRow, githubFiles, webhook, activityCounts };
}

/** The onboarding files Lore expects a repo to carry, each reported as null when the read fails. */
function fetchOnboardingFiles(fullName: string) {
  return checkRepoFiles(fullName, [
    "AGENTS.md",
    ".github/workflows/lore-ingest.yml",
  ]).catch(() => ({
    "AGENTS.md": null,
    ".github/workflows/lore-ingest.yml": null,
  }));
}
