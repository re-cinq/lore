// The nightly Utopia backfill (specs/utopia-graph-mirror FR7.7): every onboarded repo through lore-api's backfill route, one at a time, so a slow Utopia carries one repo's documents at once.

import {
  UtopiaBackfillSummarySchema,
  type UtopiaBackfillSummary,
} from "@re-cinq/lore-shared/utopia/backfill-summary.js";

/** What lore-api answered one backfill with, read whole. */
export interface BackfillAnswer {
  status: number;
  body: string;
}

export interface UtopiaBackfillTickDeps {
  repos: () => Promise<string[]>;
  backfill: (repo: string) => Promise<BackfillAnswer>;
  log: (line: string) => void;
}

export const NO_UTOPIA =
  "no Utopia on this deployment: lore-api answered the backfill 503";

type RepoOutcome = "done" | "skipped" | "failed";

type Judge = (
  repo: string,
  answer: BackfillAnswer,
  log: UtopiaBackfillTickDeps["log"],
) => RepoOutcome | "unavailable";

export async function utopiaBackfillTick(
  deps: UtopiaBackfillTickDeps,
): Promise<string> {
  const tally: Record<RepoOutcome, string[]> = {
    done: [],
    skipped: [],
    failed: [],
  };

  for (const repo of await deps.repos()) {
    const outcome = judgeAnswer(repo, await askFor(deps, repo), deps.log);

    if (outcome === "unavailable") {
      return NO_UTOPIA;
    }
    tally[outcome].push(repo);
  }

  return `utopia backfill: ${counted(tally, "done")}, ${counted(tally, "skipped")}, ${counted(tally, "failed")}`;
}

/** A dropped socket or a timeout is that repo's failure, never the sweep's: the next repo still gets its turn. */
function askFor(
  deps: UtopiaBackfillTickDeps,
  repo: string,
): Promise<BackfillAnswer> {
  return deps
    .backfill(repo)
    .catch((err: unknown) => ({ status: 0, body: (err as Error).message }));
}

const mirrored: Judge = (repo, answer, log) => {
  const summary = summaryOf(answer.body);

  if (!summary) {
    log(
      `${repo}: 200 with an unreadable summary: ${answer.body.slice(0, 300)}`,
    );

    return "failed";
  }
  log(
    `${repo}: ${summary.documents} documents at ${summary.commit.slice(0, 7)}: ${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.failed.length} failed`,
  );
  summary.failed.forEach((failure) => log(`${repo}:   failed: ${failure}`));

  return summary.failed.length === 0 ? "done" : "failed";
};

/** A 200 from a proxy in front of lore-api can carry an HTML page: that repo failed, the sweep goes on. */
function summaryOf(body: string): UtopiaBackfillSummary | null {
  try {
    return UtopiaBackfillSummarySchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
}

const skipped: Judge = (repo, answer, log) => {
  log(`${repo}: skipped, ${answer.body}`);

  return "skipped";
};

const refused: Judge = (repo, answer, log) => {
  log(
    answer.status === 0
      ? `${repo}: ${answer.body}`
      : `${repo}: HTTP ${answer.status} ${answer.body.slice(0, 300)}`,
  );

  return "failed";
};

const JUDGES: Readonly<Partial<Record<number, Judge>>> = {
  200: mirrored,
  409: skipped,
  503: () => "unavailable",
};

function judgeAnswer(
  repo: string,
  answer: BackfillAnswer,
  log: UtopiaBackfillTickDeps["log"],
): RepoOutcome | "unavailable" {
  const judge = JUDGES[answer.status] ?? refused;

  return judge(repo, answer, log);
}

function counted(
  tally: Record<RepoOutcome, string[]>,
  outcome: RepoOutcome,
): string {
  const repos = tally[outcome];

  return repos.length === 0
    ? `0 ${outcome}`
    : `${repos.length} ${outcome} (${repos.join(", ")})`;
}
