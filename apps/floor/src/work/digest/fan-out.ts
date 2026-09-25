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
    const targets = await digestTargets(deps);
    const due = await dueRepos(params, targets, deps);

    for (const [channel, repos] of byChannel(due)) {
      const members = targets.filter((t) => t.channel === channel);

      await startChannelRun({ channel, due: repos, members }, deps).catch(
        (err: Error) => console.error(`[digest] ${channel}: ${err.message}`),
      );
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

type DigestTarget = Omit<DueRepo, "since">;

/** Every repo that switched the digest on and has a channel, sorted by name: the members of each channel, due or not. */
async function digestTargets(deps: DigestFanOutDeps): Promise<DigestTarget[]> {
  const targets = (await deps.repoSettings()).map(digestTargetOf);

  return targets
    .filter((target): target is DigestTarget => target !== null)
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

function digestTargetOf(row: OnboardedRepoSettings): DigestTarget | null {
  const settings = resolveDigestSettings(row.settings?.digest);
  const channel = row.settings?.slack_channel_id;

  return channel && settings.enabled
    ? { repo: row.full_name, channel, settings }
    : null;
}

type DueCheck = typeof decideDigestDue;

/** The manual trigger's check: every enabled repo with a channel is due. */
const alwaysDue: DueCheck = () => true;

/** The targets due now; `params.repo` narrows to one repo and `params.force` skips the due check (the manual trigger). One repo whose check throws is logged and left out, never the whole tick. */
async function dueRepos(
  params: Record<string, unknown>,
  targets: DigestTarget[],
  deps: DigestFanOutDeps,
): Promise<DueRepo[]> {
  const isDue = params.force === true ? alwaysDue : decideDigestDue;
  const asked = targets.filter(
    (t) => typeof params.repo !== "string" || t.repo === params.repo,
  );
  const candidates = await Promise.all(
    asked.map((target) =>
      dueRepoOf(target, isDue, deps).catch((err: Error) => {
        console.error(`[digest] ${target.repo}: ${err.message}`);

        return null;
      }),
    ),
  );

  return candidates.filter((entry): entry is DueRepo => entry !== null);
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

interface ChannelDue {
  channel: string;
  due: DueRepo[];
  /** Every repo on the channel, due or not; the first names the run and the week's thread lists them all. */
  members: DigestTarget[];
}

interface ChannelRun {
  channel: string;
  host: DigestTarget;
  repos: DueRepo[];
  members: string[];
  date: string;
  subjectKey: string;
}

/** One run per channel per scheduled slot of a local day, keyed so a second tick joins rather than duplicates, and capped so a run that never reports does not respawn all day. Everything that can fail is read before the job_run is minted, so a failure orphans nothing. */
async function startChannelRun(
  due: ChannelDue,
  deps: DigestFanOutDeps,
): Promise<void> {
  const run = channelRunOf(due, deps.now());

  if (await skipChannel(run, deps)) {
    return;
  }
  const input = await startInput(run, deps);
  const jobRunId = await deps.jobRuns.start(`daily_digest:${run.channel}`);
  const { id, joined } = await startUnderJobRun(
    `[digest] ${run.channel}`,
    input,
    jobRunId,
    deps,
  );

  if (!joined) {
    console.log(`[digest] ${run.channel}: started run ${id}`);
  }
}

/** The host is the channel's first member by name, whichever repos are due, so the cap and the in-flight guard always look under the same repo. */
function channelRunOf(
  { channel, due, members }: ChannelDue,
  now: Date,
): ChannelRun {
  const [host] = members;
  const repos = [...due].sort((a, b) => a.repo.localeCompare(b.repo));
  const times = repos.map((r) => r.settings.time).sort();
  const { date } = localParts(now, host.settings.timezone);

  return {
    channel,
    host,
    repos,
    members: members.map((m) => m.repo),
    date,
    subjectKey: digestSubject(channel, date, times[0]),
  };
}

async function skipChannel(
  { host, subjectKey }: ChannelRun,
  deps: DigestFanOutDeps,
): Promise<boolean> {
  const [inFlight, attempts] = await Promise.all([
    deps.assemblyRuns.findOpenBySubject(host.repo, subjectKey),
    deps.assemblyRuns.countBySubject(host.repo, subjectKey),
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
  const { host } = run;
  const repoNames = run.repos.map((r) => r.repo);
  const names = repoNames.join(", ");

  return {
    blueprintName: DAILY_DIGEST_LINE,
    repo: host.repo,
    branch: `digest/${run.channel}`,
    subjectKey: run.subjectKey,
    args: {
      channel: run.channel,
      channel_repos: run.members.join(","),
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
