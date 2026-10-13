/** `lore.digest_posts` (specs/daily-digest FR7): the watermark, the weekly thread and the anti-repeat memory of the daily digest. A post is CLAIMED for its run before Slack is called and FINISHED after, so the upload receiver and the terminal-event fallback racing for one run post once; a run whose Slack call failed is ABANDONED: marked failed but keeping the week's thread it may have opened, so the next tick replies in that thread. */

export interface DigestClaim {
  repo: string;
  channelId: string;
  weekKey: string;
}

export interface DigestFinish {
  threadTs: string;
  intro: string;
  ending: string;
}

export interface DigestTexts {
  intro: string;
  ending: string;
}

export interface DigestPostsPort {
  /** When the repo's last POSTED digest went out; null before the first. */
  lastPostedAt(repo: string): Promise<Date | null>;
  /** The channel's thread for the week, from its newest row that opened or used one (a failed run keeps the thread it opened); null until then. */
  threadFor(
    channelId: string,
    weekKey: string,
  ): Promise<{ threadTs: string } | null>;
  /** The intro and ending of the channel's last `limit` posted digests, newest first, one per run. */
  recentTexts(channelId: string, limit: number): Promise<DigestTexts[]>;
  /** First writer wins: true when this call inserted the run's rows, false when another already had. */
  claim(runId: string, entries: DigestClaim[]): Promise<boolean>;
  finish(runId: string, result: DigestFinish): Promise<void>;
  /** Mark the run failed; `threadTs` is the thread it opened, or "" when it never got that far. */
  abandon(runId: string, threadTs: string): Promise<void>;
}
