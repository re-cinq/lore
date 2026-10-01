// Which channels are owed a digest now, and what each one's run carries (specs/daily-digest FR2/FR8). The tick is coarse and each repo's real cadence lives in its settings, so this decides per repo whether a digest is due and groups the due repos by Slack channel: one run per channel. Which engine starts the run, and how it guards against a second one, is the caller's.

import type { DigestPostsPort } from "../../outbound/project/digest-posts/digest-posts-port.js";
import type { OnboardedRepoSettings } from "../../outbound/project/settings/settings-port.js";
import { digestSubject } from "../../outbound/project/assembly-runs/subject-keys.js";
import {
  resolveDigestSettings,
  type ResolvedDigestSettings,
} from "../../domain/digest-settings.js";
import { decideDigestDue, localParts } from "./decide-due.js";
import { isoWeekKey } from "./iso-week.js";
import { encodeDigestRepos, type DigestRepo } from "./codec.js";

/** The first run's window when a repo has never posted. */
const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DueDeps {
  repoSettings(): Promise<OnboardedRepoSettings[]>;
  posts: Pick<DigestPostsPort, "lastPostedAt">;
  now(): Date;
}

/** One repo the tick found due, with everything its section needs. */
export interface DueRepo {
  repo: string;
  channel: string;
  settings: ResolvedDigestSettings;
  since: string;
}

export type DigestTarget = Omit<DueRepo, "since">;

/** One channel's run: the due repos it reports, every repo on the channel, and the key a second tick is recognised by. */
export interface ChannelRun {
  channel: string;
  /** The channel's first member by name, whichever repos are due, so a cap and an in-flight guard always look under the same repo. */
  host: DigestTarget;
  repos: DueRepo[];
  members: string[];
  date: string;
  /** The earliest scheduled time among the due repos: one run per channel per scheduled slot of a local day. */
  time: string;
  subjectKey: string;
}

/** The channels due now, one run each; `params.repo` narrows to one repo and `params.force` skips the due check (the manual trigger). */
export async function dueChannelRuns(
  params: Record<string, unknown>,
  deps: DueDeps,
): Promise<ChannelRun[]> {
  const targets = await digestTargets(deps);
  const due = await dueRepos(params, targets, deps);

  return [...byChannel(due)].map(([channel, repos]) =>
    channelRunOf(
      {
        channel,
        due: repos,
        members: targets.filter((t) => t.channel === channel),
      },
      deps.now(),
    ),
  );
}

function byChannel(due: DueRepo[]): Map<string, DueRepo[]> {
  return due.reduce(
    (groups, entry) =>
      groups.set(entry.channel, [...(groups.get(entry.channel) ?? []), entry]),
    new Map<string, DueRepo[]>(),
  );
}

/** Every repo that switched the digest on and has a channel, sorted by name: the members of each channel, due or not. */
async function digestTargets(deps: DueDeps): Promise<DigestTarget[]> {
  const targets = (await deps.repoSettings()).map(digestTargetOf);

  return targets
    .filter((target): target is DigestTarget => target !== null)
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

function digestTargetOf(row: OnboardedRepoSettings): DigestTarget | null {
  const settings = resolveDigestSettings(row.settings?.digest ?? undefined);
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
  deps: DueDeps,
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
  deps: DueDeps,
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

function channelRunOf(
  { channel, due, members }: ChannelDue,
  now: Date,
): ChannelRun {
  const [host] = members;
  const repos = [...due].sort((a, b) => a.repo.localeCompare(b.repo));
  const [time] = repos.map((r) => r.settings.time).sort();
  const { date } = localParts(now, host.settings.timezone);

  return {
    channel,
    host,
    repos,
    members: members.map((m) => m.repo),
    date,
    time,
    subjectKey: digestSubject(channel, date, time),
  };
}

/** What a channel's run carries, whichever engine walks it. */
export function digestRunArgs(run: ChannelRun, now: Date) {
  const repoNames = run.repos.map((r) => r.repo);

  return {
    channel: run.channel,
    channel_repos: run.members.join(","),
    week_key: isoWeekKey(now, run.host.settings.timezone),
    digest_date: run.date,
    digest_repos: encodeDigestRepos(run.repos.map(digestRepoOf)),
    voice: voiceOf(run.repos),
    description: `Daily digest for ${run.channel}: ${repoNames.join(", ")}, ${run.date}`,
  };
}

/** One message has one voice: the first due repo's that sets one, by name. */
function voiceOf(repos: DueRepo[]): string {
  const voices = repos.map((r) => r.settings.voice);

  return voices.find(Boolean) ?? "";
}

function digestRepoOf({ repo, since, settings: s }: DueRepo): DigestRepo {
  return { repo, since, sections: s.sections, group_by: s.group_by };
}
