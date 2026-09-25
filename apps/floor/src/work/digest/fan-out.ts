// Layer-3 handler for `cron.daily_digest.tick` (specs/daily-digest FR2/FR8): the tick is coarse (every 15 minutes) and each repo's real cadence lives in its settings, so the handler decides per repo whether a digest is due, then starts ONE run per Slack channel carrying every due repo of that channel.

import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { DigestPostsPort } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-port.js";
import type { OnboardedRepoSettings } from "@re-cinq/lore-shared/project/settings/settings-port.js";
import { digestSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import {
  resolveDigestSettings,
  type ResolvedDigestSettings,
} from "@re-cinq/lore-shared/digest-settings.js";
import { decideDigestDue, localParts } from "@re-cinq/lore-shared/digest/decide-due.js";
import { isoWeekKey } from "@re-cinq/lore-shared/digest/iso-week.js";
import { encodeDigestRepos, type DigestRepo } from "@re-cinq/lore-shared/digest/codec.js";
import {
  DAILY_DIGEST_LINE,
  MAX_RUNS_PER_CHANNEL_DAY,
} from "@re-cinq/lore-shared/digest/contract.js";
import type { EventHandler } from "../../domain/event-types.js";
import { pipeline, settings } from "../../outbound/queues.js";
import { projectFor } from "../../outbound/project-boot.js";
import { startUnderJobRun } from "../fan-out/start-under-job-run.js";

/** The first run's window when a repo has never posted. */
const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DigestFanOutDeps {
  repoSettings(): Promise<OnboardedRepoSettings[]>;
  posts: Pick<DigestPostsPort, "lastPostedAt">;
  assemblyRuns: Pick<
    AssemblyRunsPort,
    "start" | "getById" | "findOpenBySubject" | "countBySubject"
  >;
  jobRuns: {
    start(jobName: string): Promise<string>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
  defaultBranch(repo: string): Promise<string>;
  now(): Date;
}

/** One repo the tick found due, with everything its section needs. */
export interface DueRepo {
  repo: string;
  channel: string;
  settings: ResolvedDigestSettings;
  since: string;
}

export function createDailyDigestTickHandler(
  deps: DigestFanOutDeps,
): EventHandler {
  return async (params) => {
    const due = await dueRepos(params, deps);

    for (const [channel, repos] of byChannel(due)) {
      await startChannelRun(channel, repos, deps);
    }
  };
}

function byChannel(due: DueRepo[]): Map<string, DueRepo[]> {
  return due.reduce(
    (groups, entry) =>
      groups.set(entry.channel, [...(groups.get(entry.channel) ?? []), entry]),
    new Map<string, DueRepo[]>(),
  );
}

/** Every onboarded repo whose digest is due now; `params.repo` narrows to one repo and `params.force` skips the due check (the manual trigger). */
async function dueRepos(
  params: Record<string, unknown>,
  deps: DigestFanOutDeps,
): Promise<DueRepo[]> {
  const rows = (await deps.repoSettings()).filter(
    (row) => typeof params.repo !== "string" || row.full_name === params.repo,
  );
  const candidates = await Promise.all(
    rows.map((row) => dueRepoOf(row, params.force === true, deps)),
  );

  return candidates.filter((entry): entry is DueRepo => entry !== null);
}

async function dueRepoOf(
  row: OnboardedRepoSettings,
  force: boolean,
  deps: DigestFanOutDeps,
): Promise<DueRepo | null> {
  const resolved = resolveDigestSettings(row.settings?.digest);
  const channel = row.settings?.slack_channel_id;

  if (!channel || !resolved.enabled) {
    return null;
  }
  const lastPostedAt = await deps.posts.lastPostedAt(row.full_name);
  const now = deps.now();

  if (!force && !decideDigestDue({ settings: resolved, now, lastPostedAt })) {
    return null;
  }
  const since = lastPostedAt ?? new Date(now.getTime() - FIRST_WINDOW_MS);

  return { repo: row.full_name, channel, settings: resolved, since: since.toISOString() };
}

/** One run per channel per local day, keyed so a second tick joins rather than duplicates, and capped so a run that never reports does not respawn all day. */
async function startChannelRun(
  channel: string,
  repos: DueRepo[],
  deps: DigestFanOutDeps,
): Promise<void> {
  const sorted = [...repos].sort((a, b) => a.repo.localeCompare(b.repo));
  const host = sorted[0];
  const { date } = localParts(deps.now(), host.settings.timezone);
  const subjectKey = digestSubject(channel, date);

  if (await skipChannel(host.repo, subjectKey, deps)) {
    return;
  }
  const jobRunId = await deps.jobRuns.start(`daily_digest:${channel}`);
  const { id, joined } = await startUnderJobRun(
    `[digest] ${channel}`,
    {
      blueprintName: DAILY_DIGEST_LINE,
      repo: host.repo,
      branch: `digest/${channel}`,
      subjectKey,
      args: await runArgs(channel, date, sorted, deps),
    },
    jobRunId,
    deps,
  );

  if (!joined) {
    console.log(`[digest] ${channel}: started run ${id} for ${sorted.map((r) => r.repo).join(", ")}`);
  }
}

async function skipChannel(
  hostRepo: string,
  subjectKey: string,
  deps: DigestFanOutDeps,
): Promise<boolean> {
  const [inFlight, attempts] = await Promise.all([
    deps.assemblyRuns.findOpenBySubject(hostRepo, subjectKey),
    deps.assemblyRuns.countBySubject(hostRepo, subjectKey),
  ]);

  if (inFlight) {
    console.log(`[digest] ${subjectKey} already running as ${inFlight.id}, skipping`);
  }

  if (attempts >= MAX_RUNS_PER_CHANNEL_DAY) {
    console.log(`[digest] ${subjectKey} started ${attempts} times today, giving up`);
  }

  return inFlight !== null || attempts >= MAX_RUNS_PER_CHANNEL_DAY;
}

/** `ref` is the host repo's default branch: an agent node clones `args.ref`, and the run's own branch name is only the lease key. */
async function runArgs(
  channel: string,
  date: string,
  repos: DueRepo[],
  deps: DigestFanOutDeps,
): Promise<Record<string, unknown>> {
  const host = repos[0];
  const names = repos.map((r) => r.repo);
  const entries: DigestRepo[] = repos.map(({ repo, since, settings: s }) => ({
    repo,
    since,
    sections: s.sections,
    group_by: s.group_by,
  }));

  return {
    channel,
    week_key: isoWeekKey(deps.now(), host.settings.timezone),
    digest_date: date,
    digest_repos: encodeDigestRepos(entries),
    ref: await deps.defaultBranch(host.repo),
    description: `Daily digest for ${channel}: ${names.join(", ")}, ${date}`,
  };
}

export const dailyDigestTick: EventHandler = (params) =>
  createDailyDigestTickHandler({
    repoSettings: () => settings().onboardedRepoSettings(),
    posts: pipeline().digestPosts,
    assemblyRuns: pipeline().assemblyRuns,
    jobRuns: pipeline().jobRuns,
    defaultBranch: async (repo) => (await projectFor(repo)).repo.defaultBranch(),
    now: () => new Date(),
  })(params);
