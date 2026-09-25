// Layer-3 handler for `cron.daily_digest.tick` (specs/daily-digest FR2/FR8): the tick is coarse (every 15 minutes) and each repo's real cadence lives in its settings, so the handler decides per repo whether a digest is due, then starts ONE run per Slack channel carrying every due repo of that channel.

import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { DigestPostsPort } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-port.js";
import type { OnboardedRepoSettings } from "@re-cinq/lore-shared/project/settings/settings-port.js";
import { digestSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import {
  resolveDigestSettings,
  type ResolvedDigestSettings,
} from "@re-cinq/lore-shared/digest-settings.js";
import {
  decideDigestDue,
  localParts,
} from "@re-cinq/lore-shared/digest/decide-due.js";
import { isoWeekKey } from "@re-cinq/lore-shared/digest/iso-week.js";
import {
  encodeDigestRepos,
  type DigestRepo,
} from "@re-cinq/lore-shared/digest/codec.js";
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

type DueCheck = typeof decideDigestDue;

/** The manual trigger's check: every enabled repo with a channel is due. */
const alwaysDue: DueCheck = () => true;

/** Every onboarded repo whose digest is due now; `params.repo` narrows to one repo and `params.force` skips the due check (the manual trigger). */
async function dueRepos(
  params: Record<string, unknown>,
  deps: DigestFanOutDeps,
): Promise<DueRepo[]> {
  const isDue = params.force === true ? alwaysDue : decideDigestDue;
  const targets = (await deps.repoSettings())
    .filter(
      (row) => typeof params.repo !== "string" || row.full_name === params.repo,
    )
    .map(digestTargetOf)
    .filter((target): target is DigestTarget => target !== null);
  const candidates = await Promise.all(
    targets.map((target) => dueRepoOf(target, isDue, deps)),
  );

  return candidates.filter((entry): entry is DueRepo => entry !== null);
}

type DigestTarget = Omit<DueRepo, "since">;

/** A repo that has switched the digest on and has a channel to post it to; null otherwise. */
function digestTargetOf(row: OnboardedRepoSettings): DigestTarget | null {
  const settings = resolveDigestSettings(row.settings?.digest);
  const channel = row.settings?.slack_channel_id;

  return channel && settings.enabled
    ? { repo: row.full_name, channel, settings }
    : null;
}

/** The window opens at the repo's last finished post, or 24 hours back before its first. */
async function dueRepoOf(
  target: DigestTarget,
  isDue: DueCheck,
  deps: DigestFanOutDeps,
): Promise<DueRepo | null> {
  const lastPostedAt = await deps.posts.lastPostedAt(target.repo);
  const now = deps.now();

  if (!isDue({ settings: target.settings, now, lastPostedAt })) {
    return null;
  }
  const since = lastPostedAt ?? new Date(now.getTime() - FIRST_WINDOW_MS);

  return { ...target, since: since.toISOString() };
}

interface ChannelRun {
  channel: string;
  /** Sorted by repo name; the first is the host the run is labelled with. */
  repos: DueRepo[];
  date: string;
  subjectKey: string;
}

/** One run per channel per local day, keyed so a second tick joins rather than duplicates, and capped so a run that never reports does not respawn all day. */
async function startChannelRun(
  channel: string,
  repos: DueRepo[],
  deps: DigestFanOutDeps,
): Promise<void> {
  const run = channelRunOf(channel, repos, deps.now());

  if (await skipChannel(run, deps)) {
    return;
  }
  const jobRunId = await deps.jobRuns.start(`daily_digest:${channel}`);
  const { id, joined } = await startUnderJobRun(
    `[digest] ${channel}`,
    await startInput(run, deps),
    jobRunId,
    deps,
  );

  if (!joined) {
    console.log(`[digest] ${channel}: started run ${id}`);
  }
}

function channelRunOf(
  channel: string,
  repos: DueRepo[],
  now: Date,
): ChannelRun {
  const sorted = [...repos].sort((a, b) => a.repo.localeCompare(b.repo));
  const [{ settings: hostSettings }] = sorted;
  const { date } = localParts(now, hostSettings.timezone);

  return {
    channel,
    repos: sorted,
    date,
    subjectKey: digestSubject(channel, date),
  };
}

async function skipChannel(
  { repos, subjectKey }: ChannelRun,
  deps: DigestFanOutDeps,
): Promise<boolean> {
  const hostRepo = repos[0].repo;
  const [inFlight, attempts] = await Promise.all([
    deps.assemblyRuns.findOpenBySubject(hostRepo, subjectKey),
    deps.assemblyRuns.countBySubject(hostRepo, subjectKey),
  ]);
  const reason = skipReason(inFlight?.id, attempts);

  if (reason) {
    console.log(`[digest] ${subjectKey} ${reason}, skipping`);
  }

  return reason !== null;
}

function skipReason(
  inFlightId: string | undefined,
  attempts: number,
): string | null {
  if (inFlightId) {
    return `already running as ${inFlightId}`;
  }

  return attempts >= MAX_RUNS_PER_CHANNEL_DAY
    ? `started ${attempts} times today`
    : null;
}

/** `ref` is the host repo's default branch: an agent node clones `args.ref`, and the run's own branch name is only the lease key. */
async function startInput(run: ChannelRun, deps: DigestFanOutDeps) {
  const host = run.repos[0];
  const repoNames = run.repos.map((r) => r.repo);
  const names = repoNames.join(", ");

  return {
    blueprintName: DAILY_DIGEST_LINE,
    repo: host.repo,
    branch: `digest/${run.channel}`,
    subjectKey: run.subjectKey,
    args: {
      channel: run.channel,
      week_key: isoWeekKey(deps.now(), host.settings.timezone),
      digest_date: run.date,
      digest_repos: encodeDigestRepos(run.repos.map(digestRepoOf)),
      ref: await deps.defaultBranch(host.repo),
      description: `Daily digest for ${run.channel}: ${names}, ${run.date}`,
    },
  };
}

function digestRepoOf({ repo, since, settings: s }: DueRepo): DigestRepo {
  return { repo, since, sections: s.sections, group_by: s.group_by };
}

export const dailyDigestTick: EventHandler = (params) =>
  createDailyDigestTickHandler({
    repoSettings: () => settings().onboardedRepoSettings(),
    posts: pipeline().digestPosts,
    assemblyRuns: pipeline().assemblyRuns,
    jobRuns: pipeline().jobRuns,
    defaultBranch: async (repo) =>
      (await projectFor(repo)).repo.defaultBranch(),
    now: () => new Date(),
  })(params);
