// What a push handler logs of lore-api's answer to one commit walk: the walk's numbers on a 200, a quiet skip where the repo has no Utopia source or the deployment no Utopia, the refusal otherwise.

import { UtopiaCommitsSummarySchema } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import type { BackfillAnswer } from "./utopia-backfill-tick.js";

const SKIPPED: Readonly<Partial<Record<number, string>>> = {
  409: "skipped, no Utopia source for this repo",
  503: "skipped, no Utopia on this deployment",
};

export function commitsAnswerLine(answer: BackfillAnswer): string {
  if (answer.status === 200) {
    return walkLine(answer.body);
  }

  return (
    SKIPPED[answer.status] ??
    `HTTP ${answer.status} ${answer.body.slice(0, 300)}`
  );
}

function walkLine(body: string): string {
  const parsed = UtopiaCommitsSummarySchema.safeParse(parsedJson(body));

  if (!parsed.success) {
    return `HTTP 200 with an unreadable body ${body.slice(0, 300)}`;
  }
  const walk = parsed.data;

  if (walk.skipped) {
    return `${walk.branch}: ${walk.skipped}`;
  }
  const stops = walk.failed.map((failure) => `; stopped at ${failure}`);

  return `${walk.commits} commits from ${short(walk.from) ?? "the root"} to ${short(walk.to) ?? "none"}: ${walk.created} created, ${walk.updated} updated, ${walk.unchanged} unchanged${stops.join("")}`;
}

function parsedJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function short(sha: string | null): string | null {
  return sha === null ? null : sha.slice(0, 7);
}
