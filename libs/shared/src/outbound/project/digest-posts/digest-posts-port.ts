/** `lore.digest_posts` (specs/daily-digest FR7): the watermark, the weekly thread and the anti-repeat memory of the daily digest. A post is CLAIMED for its run before Slack is called and FINISHED after, so the upload receiver and the terminal-event fallback racing for one run post once; a claim whose Slack call failed is RELEASED so the next tick may try again. */

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
  /** When the repo's last FINISHED digest went out; null before the first. */
  lastPostedAt(repo: string): Promise<Date | null>;
  /** The channel's thread for the week, from its newest finished post; null until the first post of the week. */
  threadFor(
    channelId: string,
    weekKey: string,
  ): Promise<{ threadTs: string } | null>;
  /** The intro and ending of the channel's last `limit` finished posts, newest first, one per run. */
  recentTexts(channelId: string, limit: number): Promise<DigestTexts[]>;
  /** First writer wins: true when this call inserted the run's rows, false when another already had. */
  claim(runId: string, entries: DigestClaim[]): Promise<boolean>;
  finish(runId: string, result: DigestFinish): Promise<void>;
  release(runId: string): Promise<void>;
}
