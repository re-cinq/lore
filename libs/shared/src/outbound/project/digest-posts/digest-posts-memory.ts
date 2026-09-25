import type { DigestPost } from "../../../domain/models/digest-post.js";
import type {
  DigestClaim,
  DigestFinish,
  DigestPostsPort,
  DigestTexts,
} from "./digest-posts-port.js";

/** In-memory DigestPostsPort: keeps every row, the behavioral spec of the pg adapter. `now` is injectable so a test can post "yesterday". */
export class InMemoryDigestPosts implements DigestPostsPort {
  readonly rows: DigestPost[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async lastPostedAt(repo: string): Promise<Date | null> {
    const finished = this.posted()
      .filter((row) => row.repo === repo)
      .sort(newestFirst);

    return finished[0]?.postedAt ?? null;
  }

  async threadFor(
    channelId: string,
    weekKey: string,
  ): Promise<{ threadTs: string } | null> {
    const inWeek = this.rows
      .filter((row) => row.threadTs !== "")
      .filter((row) => row.channelId === channelId && row.weekKey === weekKey)
      .sort(newestFirst);

    return inWeek[0] ? { threadTs: inWeek[0].threadTs } : null;
  }

  async recentTexts(channelId: string, limit: number): Promise<DigestTexts[]> {
    const perRun = new Map<string, DigestPost>();

    for (const row of this.posted().filter(
      (r) => r.channelId === channelId,
    )) {
      perRun.set(row.runId, row);
    }

    return [...perRun.values()]
      .sort(newestFirst)
      .slice(0, limit)
      .map(({ intro, ending }) => ({ intro, ending }));
  }

  async claim(runId: string, entries: DigestClaim[]): Promise<boolean> {
    if (this.rows.some((row) => row.runId === runId)) {
      return false;
    }
    this.rows.push(
      ...entries.map(({ repo, channelId, weekKey }) => ({
        runId,
        repo,
        channelId,
        weekKey,
        status: "claimed" as const,
        threadTs: "",
        intro: "",
        ending: "",
        postedAt: this.now(),
      })),
    );

    return true;
  }

  async finish(runId: string, result: DigestFinish): Promise<void> {
    for (const row of this.rows.filter((r) => r.runId === runId)) {
      Object.assign(row, result, { status: "posted", postedAt: this.now() });
    }
  }

  async abandon(runId: string, threadTs: string): Promise<void> {
    const claimed = this.rows.filter(
      (r) => r.runId === runId && r.status === "claimed",
    );

    for (const row of claimed) {
      Object.assign(row, { status: "failed", threadTs, postedAt: this.now() });
    }
  }

  private posted(): DigestPost[] {
    return this.rows.filter((row) => row.status === "posted");
  }
}

const newestFirst = (a: DigestPost, b: DigestPost): number =>
  b.postedAt.getTime() - a.postedAt.getTime();
