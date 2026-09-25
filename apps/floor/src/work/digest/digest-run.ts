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
  draft: string | null;
}

/** Null for a run that is not a digest run, or one whose args a fan-out never wrote. */
export function digestRunOf(run: AssemblyRunRecord): DigestRun | null {
  const { channel, week_key, digest_date, digest_repos, digest_draft } =
    run.args;

  if (![channel, week_key, digest_date, digest_repos].every(isText)) {
    return null;
  }

  return {
    id: run.id,
    channel: channel as string,
    weekKey: week_key as string,
    date: digest_date as string,
    repos: decodeDigestRepos(digest_repos as string),
    draft: isText(digest_draft) ? digest_draft : null,
  };
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
