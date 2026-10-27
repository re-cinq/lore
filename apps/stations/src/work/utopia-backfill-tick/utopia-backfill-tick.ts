// The weekly Utopia backfill (specs/utopia-graph-mirror FR7.7): every onboarded repo through lore-api's backfill route, one at a time, so a slow Utopia carries one repo's documents at once.

import {
  UtopiaBackfillSummarySchema,
  type UtopiaBackfillSummary,
} from "@re-cinq/lore-shared/utopia/backfill-summary.js";

import {
  askFor,
  counted,
  refusedLine,
  type RepoAnswer,
} from "../lib/repo-sweep.js";

/** What lore-api answered one backfill with, read whole. */
export type BackfillAnswer = RepoAnswer;

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
    const answer = await askFor(deps.backfill, repo);
    const outcome = judgeAnswer(repo, answer, deps.log);

    if (outcome === "unavailable") {
      return NO_UTOPIA;
    }
    tally[outcome].push(repo);
  }

  return `utopia backfill: ${counted(tally, "done")}, ${counted(tally, "skipped")}, ${counted(tally, "failed")}`;
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
  log(refusedLine(repo, answer));

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
