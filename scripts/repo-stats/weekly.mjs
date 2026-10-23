// One repository's raw rows (pull requests, commits on main, floor runs, blocked spans) folded into ISO weeks, plus the lists of where Lore helped and where it got in the way. Pure: every clock reading is passed in.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LORE_LOGIN = /^lore-agent/;
const LORE_TRAILER = /^Lore-Task:/m;
const FAILED_OUTCOMES = new Set(["error", "failed", "cancelled"]);
// A request for changes and a comment both carry findings; an approval asks for nothing.
const FINDING_STATES = new Set(["CHANGES_REQUESTED", "COMMENTED"]);
const LISTED = 10;

const ms = (instant) => new Date(instant).getTime();
const hoursBetween = (from, to) => (ms(to) - ms(from)) / HOUR_MS;
const share = (part, whole) => (whole === 0 ? null : part / whole);
const sum = (values) => values.reduce((total, value) => total + value, 0);

export function isoWeekKey(instant) {
  const day = new Date(instant);
  const thursday = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  );

  thursday.setUTCDate(thursday.getUTCDate() + 3 - mondayIndex(thursday));
  const firstThursday = Date.UTC(thursday.getUTCFullYear(), 0, 4);
  const firstWeekMonday =
    firstThursday - mondayIndex(new Date(firstThursday)) * DAY_MS;
  const week =
    1 + Math.floor((thursday.getTime() - firstWeekMonday) / (7 * DAY_MS));

  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const mondayIndex = (date) => (date.getUTCDay() + 6) % 7;

/** The `count` ISO weeks ending with the one `today` falls in, oldest first. */
export function windowWeeks(today, count) {
  const day = new Date(`${today.slice(0, 10)}T00:00:00Z`);
  const monday = day.getTime() - mondayIndex(day) * DAY_MS;

  return Array.from({ length: count }, (_, index) => {
    const from = monday - (count - 1 - index) * 7 * DAY_MS;

    return {
      key: isoWeekKey(new Date(from)),
      from: new Date(from).toISOString().slice(0, 10),
      to: new Date(from + 6 * DAY_MS).toISOString().slice(0, 10),
    };
  });
}

export function authorKind(login, isBot) {
  if (LORE_LOGIN.test(login)) {
    return "lore";
  }

  return isBot ? "bot" : "human";
}

export function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const kindOf = (pull) => authorKind(pull.author, pull.isBot);
const isLoreCommit = (commit) =>
  LORE_LOGIN.test(commit.author ?? "") || LORE_TRAILER.test(commit.message);
const isFailedRun = (run) =>
  run.status === "failed" || FAILED_OUTCOMES.has(run.outcome);
const loreReviews = (pull) =>
  pull.reviews.filter((review) => LORE_LOGIN.test(review.author ?? ""));
const closedUnmerged = (pull) =>
  pull.closedAt !== null && pull.mergedAt === null;

function fixedAfterReview(pull) {
  const findings = loreReviews(pull).filter((review) =>
    FINDING_STATES.has(review.state),
  );

  return findings.some((review) =>
    pull.commitDates.some((date) => ms(date) > ms(review.submittedAt)),
  );
}

function pullCounts(pulls) {
  const merged = pulls.filter((pull) => pull.mergedAt !== null);

  return {
    opened: pulls.length,
    merged: merged.length,
    closedUnmerged: pulls.filter(closedUnmerged).length,
    medianHoursToMerge: median(
      merged.map((pull) => hoursBetween(pull.createdAt, pull.mergedAt)),
    ),
  };
}

function pullStats(pulls) {
  const lore = pullCounts(pulls.filter((pull) => kindOf(pull) === "lore"));
  const human = pullCounts(pulls.filter((pull) => kindOf(pull) === "human"));

  return {
    lore,
    human,
    loreShareOfMerged: share(lore.merged, lore.merged + human.merged),
  };
}

function reviewStats(pulls) {
  const humanPulls = pulls.filter((pull) => kindOf(pull) === "human");
  const reviewed = humanPulls.filter((pull) => loreReviews(pull).length > 0);
  const firstReviewHours = reviewed.map((pull) =>
    hoursBetween(
      pull.createdAt,
      loreReviews(pull)
        .map((review) => review.submittedAt)
        .sort()[0],
    ),
  );

  return {
    humanPulls: humanPulls.length,
    reviewed: reviewed.length,
    coverage: share(reviewed.length, humanPulls.length),
    medianHoursToReview: median(firstReviewHours),
    changesRequested: reviewed.filter((pull) =>
      loreReviews(pull).some((review) => review.state === "CHANGES_REQUESTED"),
    ).length,
    fixedAfterReview: reviewed.filter(fixedAfterReview).length,
  };
}

function runTally(runs) {
  return {
    runs: runs.length,
    failed: runs.filter(isFailedRun).length,
    costUsd: sum(runs.map((run) => run.cost_usd ?? 0)),
  };
}

function runStats(runs) {
  const lines = [...new Set(runs.map((run) => run.blueprint_name))].sort();
  const { runs: total, ...tally } = runTally(runs);

  return {
    total,
    ...tally,
    byLine: Object.fromEntries(
      lines.map((line) => [
        line,
        runTally(runs.filter((run) => run.blueprint_name === line)),
      ]),
    ),
  };
}

function commitStats(commits) {
  const lore = commits.filter(isLoreCommit).length;

  return {
    lore,
    human: commits.length - lore,
    loreShare: share(lore, commits.length),
  };
}

const blockedEnd = (span, now) => span.closed_at ?? now;

function overlapHours(span, week, now) {
  const weekStart = ms(`${week.from}T00:00:00Z`);
  const from = Math.max(ms(span.since), weekStart);
  const to = Math.min(ms(blockedEnd(span, now)), weekStart + 7 * DAY_MS);

  return Math.max(0, to - from) / HOUR_MS;
}

/** One row per week: pull requests and runs fall in the week they were opened, commits in the week they landed, blocked hours wherever they overlap it. */
export function weeklyStats(raw, weeks, now) {
  const inWeek = (week) => (instant) => isoWeekKey(instant) === week.key;

  return weeks.map((week) => {
    const opened = raw.pulls.filter((pull) => inWeek(week)(pull.createdAt));

    return {
      week,
      pulls: pullStats(opened),
      reviews: reviewStats(opened),
      runs: runStats(raw.runs.filter((run) => inWeek(week)(run.created_at))),
      commits: commitStats(
        raw.commits.filter((commit) => inWeek(week)(commit.date)),
      ),
      blockedHours: sum(
        raw.blocked.map((span) => overlapHours(span, week, now)),
      ),
      intro:
        raw.changelog.find((entry) => entry.weekKey === week.key)?.intro ??
        null,
    };
  });
}

const inWindow = (weeks) => {
  const keys = new Set(weeks.map((week) => week.key));

  return (instant) => keys.has(isoWeekKey(instant));
};

function failureReasons(runs) {
  const counts = new Map();

  for (const run of runs.filter(isFailedRun)) {
    const reason = run.reason ?? run.outcome ?? "no reason recorded";
    const key = `${run.blueprint_name}\u0000${reason}`;

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts]
    .map(([key, count]) => {
      const [line, reason] = key.split("\u0000");

      return { line, reason, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, LISTED);
}

/** Where Lore got in the way: its most common failures, its pull requests nobody merged, and the pull requests it held up longest. */
export function blockers(raw, weeks, now) {
  const counted = inWindow(weeks);
  const windowHours = (span) =>
    sum(weeks.map((week) => overlapHours(span, week, now)));

  return {
    reasons: failureReasons(raw.runs.filter((run) => counted(run.created_at))),
    closedUnmerged: raw.pulls
      .filter((pull) => kindOf(pull) === "lore" && counted(pull.createdAt))
      .filter(closedUnmerged)
      .map(({ number, title }) => ({ number, title })),
    longestBlocked: raw.blocked
      .map((span) => ({
        number: span.pr_number,
        reason: span.reason,
        hours: Math.round(windowHours(span)),
      }))
      .filter((span) => span.hours > 0)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, LISTED),
  };
}

/** Where Lore helped: its merged pull requests, and the human ones that changed after its review. */
export function helped(raw, weeks) {
  const counted = inWindow(weeks);
  const pulls = raw.pulls.filter((pull) => counted(pull.createdAt));

  return {
    merged: pulls
      .filter((pull) => kindOf(pull) === "lore" && pull.mergedAt !== null)
      .map(({ number, title, createdAt, mergedAt }) => ({
        number,
        title,
        hoursToMerge: Math.round(hoursBetween(createdAt, mergedAt)),
      })),
    fixedAfterReview: pulls
      .filter((pull) => kindOf(pull) === "human")
      .filter(fixedAfterReview)
      .map(({ number, title }) => ({ number, title })),
  };
}
