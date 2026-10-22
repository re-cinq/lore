// What an event handler logs of lore-api's answer to one commit, tracker or release walk: the walk's numbers on a 200, a quiet skip where the repo has no Utopia source or the deployment no Utopia, the refusal otherwise.

import type { z } from "zod";
import {
  UtopiaCommitsSummarySchema,
  type UtopiaCommitsSummary,
} from "@re-cinq/lore-shared/utopia/commits-summary.js";
import {
  UtopiaReleasesSummarySchema,
  type UtopiaReleasesSummary,
} from "@re-cinq/lore-shared/utopia/releases-summary.js";
import {
  UtopiaTrackerSummarySchema,
  type UtopiaTrackerSummary,
} from "@re-cinq/lore-shared/utopia/tracker-summary.js";
import type { BackfillAnswer } from "./utopia-backfill-tick.js";

const SKIPPED: Readonly<Partial<Record<number, string>>> = {
  409: "skipped, no Utopia source for this repo",
  503: "skipped, no Utopia on this deployment",
};

export function commitsAnswerLine(answer: BackfillAnswer): string {
  return answerLine(answer, UtopiaCommitsSummarySchema, commitsLine);
}

export function trackerAnswerLine(answer: BackfillAnswer): string {
  return answerLine(answer, UtopiaTrackerSummarySchema, trackerLine);
}

export function releasesAnswerLine(answer: BackfillAnswer): string {
  return answerLine(answer, UtopiaReleasesSummarySchema, releasesLine);
}

function answerLine<T>(
  answer: BackfillAnswer,
  schema: z.ZodType<T>,
  line: (walk: T) => string,
): string {
  if (answer.status !== 200) {
    return (
      SKIPPED[answer.status] ??
      `HTTP ${answer.status} ${answer.body.slice(0, 300)}`
    );
  }
  const parsed = schema.safeParse(parsedJson(answer.body));

  return parsed.success
    ? line(parsed.data)
    : `HTTP 200 with an unreadable body ${answer.body.slice(0, 300)}`;
}

function commitsLine(walk: UtopiaCommitsSummary): string {
  if (walk.skipped) {
    return `${walk.branch}: ${walk.skipped}`;
  }

  return `${walk.commits} commits from ${short(walk.from) ?? "the root"} to ${short(walk.to) ?? "none"}: ${counts(walk)}`;
}

function trackerLine(walk: UtopiaTrackerSummary): string {
  return `${walk.entries} issues and pull requests updated from ${walk.from ?? "the beginning"} to ${walk.to ?? "none"}: ${counts(walk)}`;
}

/** A release push sends every item and stops at none, so its failures read as refusals. */
function releasesLine(push: UtopiaReleasesSummary): string {
  return `${push.tags} tags and ${push.releases} releases: ${counts(push, "refused")}`;
}

function counts(
  walk: UtopiaCommitsSummary | UtopiaTrackerSummary | UtopiaReleasesSummary,
  failedAs = "stopped at",
): string {
  const stops = walk.failed.map((failure) => `; ${failedAs} ${failure}`);

  return `${walk.created} created, ${walk.updated} updated, ${walk.unchanged} unchanged${stops.join("")}`;
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
