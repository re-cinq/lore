// What a daily-digest run carries in its args, read once and typed: the channel, the week, the local date, the repos with their windows, and the draft once the Floor served it (specs/daily-digest FR8/FR10).

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  decodeDigestRepos,
  type DigestRepo,
} from "@re-cinq/lore-shared/digest/codec.js";

export interface DigestRun {
  id: string;
  channel: string;
  weekKey: string;
  date: string;
  repos: DigestRepo[];
  /** Every repo on the channel, for the week's thread parent; the run's own repos when an older fan-out did not say. */
  channelRepos: string[];
  draft: string | null;
}

/** Null for a run that is not a digest run, or one whose args a fan-out never wrote. */
export function digestRunOf(run: AssemblyRunRecord): DigestRun | null {
  const { args } = run;

  if (!hasDigestArgs(args)) {
    return null;
  }
  const repos = decodeDigestRepos(args.digest_repos as string);

  return {
    id: run.id,
    channel: args.channel as string,
    weekKey: args.week_key as string,
    date: args.digest_date as string,
    repos,
    channelRepos: channelReposOf(args.channel_repos, repos),
    draft: isText(args.digest_draft) ? args.digest_draft : null,
  };
}

/** The four args every digest fan-out writes. */
function hasDigestArgs(args: Record<string, unknown>): boolean {
  const { channel, week_key, digest_date, digest_repos } = args;

  return [channel, week_key, digest_date, digest_repos].every(isText);
}

/** Every repo on the channel, or the run's own repos when an older fan-out did not say. */
function channelReposOf(raw: unknown, repos: DigestRepo[]): string[] {
  return isText(raw) ? raw.split(",") : repos.map((r) => r.repo);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
