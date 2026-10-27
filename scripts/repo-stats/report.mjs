// The markdown report of what Lore did on a set of repositories over a window of weeks, all of them pooled: one summary row, the weekly tables, and the lists of where it helped and where it blocked.

import { knownSum } from "./weekly.mjs";

const LISTED = 10;

const sum = (values) => values.reduce((total, value) => total + value, 0);
const ratio = (part, whole) => (whole === 0 ? null : part / whole);
const percent = (value) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
// Most reviews and human merges land inside the hour, which whole hours would print as a column of zeros.
const hours = (value) => {
  if (value === null) {
    return "—";
  }

  return value < 10 ? value.toFixed(1) : String(Math.round(value));
};
const dollars = (value) => (value === null ? "—" : `$${value.toFixed(2)}`);

const row = (cells) => `| ${cells.join(" | ")} |`;
const table = (headers, rows) =>
  [row(headers), row(headers.map(() => "---")), ...rows.map(row)].join("\n");

/** A share pooled over the first half of the weeks and over the second, so one quiet week, or the week still running, does not decide the direction. */
export function trend(weekly, partOf, wholeOf) {
  const middle = Math.floor(weekly.length / 2);
  const pooled = (weeks) =>
    ratio(sum(weeks.map(partOf)), sum(weeks.map(wholeOf)));

  return {
    before: pooled(weekly.slice(0, middle)),
    after: pooled(weekly.slice(middle)),
  };
}

const loreMerged = (week) => week.pulls.lore.merged;
const allMerged = (week) => week.pulls.lore.merged + week.pulls.human.merged;
const reviewed = (week) => week.reviews.reviewed;
const humanPulls = (week) => week.reviews.humanPulls;
const failedRuns = (week) => week.runs.failed;
const finishedRuns = (week) => week.runs.total - week.runs.cancelled;

const shortName = (repo) => repo.split("/")[1];
const pullRef = (item) => `${shortName(item.repo)}#${item.number}`;

function summaryRow({ repos, weekly, helped }) {
  const total = (of) => sum(weekly.map(of));
  const cost = knownSum(weekly.map((week) => week.runs.costUsd));

  return [
    repos.map(shortName).join(", "),
    total(loreMerged),
    total((week) => week.pulls.human.merged),
    percent(ratio(total(loreMerged), total(allMerged))),
    percent(ratio(total(reviewed), total(humanPulls))),
    helped.fixedAfterReview.length,
    percent(ratio(total(failedRuns), total(finishedRuns))),
    dollars(cost),
    dollars(cost === null ? null : ratio(cost, total(loreMerged))),
  ];
}

function trendLine(weekly) {
  const shown = (name, { before, after }) =>
    `${name} ${percent(before)} → ${percent(after)}`;

  return `First half → second half of the window: ${[
    shown("Lore's share of merged PRs", trend(weekly, loreMerged, allMerged)),
    shown("review coverage", trend(weekly, reviewed, humanPulls)),
    shown("run failure rate", trend(weekly, failedRuns, finishedRuns)),
  ].join("; ")}.`;
}

function costliestLine(byLine) {
  const [line, tally] = Object.entries(byLine).sort(
    ([, a], [, b]) => b.costUsd - a.costUsd,
  )[0] ?? ["—"];

  return (tally?.costUsd ?? 0) > 0 ? line : "—";
}

function weeklyTables(weekly, withDb) {
  const key = (week) => week.week.key;

  return [
    "## Pull requests",
    table(
      [
        "Week",
        "Lore opened",
        "Lore merged",
        "Lore closed unmerged",
        "Lore h to merge",
        "Human opened",
        "Human merged",
        "Human h to merge",
        "Lore share of merged",
      ],
      weekly.map((week) => {
        const { lore, human, loreShareOfMerged } = week.pulls;

        return [
          key(week),
          lore.opened,
          lore.merged,
          lore.closedUnmerged,
          hours(lore.medianHoursToMerge),
          human.opened,
          human.merged,
          hours(human.medianHoursToMerge),
          percent(loreShareOfMerged),
        ];
      }),
    ),
    "## Reviews of human PRs",
    table(
      [
        "Week",
        "Human PRs",
        "Reviewed by Lore",
        "Coverage",
        "h to first review",
        "Changes requested",
        "Fixed after review",
      ],
      weekly.map(({ reviews, ...week }) => [
        key(week),
        reviews.humanPulls,
        reviews.reviewed,
        percent(reviews.coverage),
        hours(reviews.medianHoursToReview),
        reviews.changesRequested,
        reviews.fixedAfterReview,
      ]),
    ),
    "## Floor runs and cost",
    table(
      [
        "Week",
        "Runs",
        "Cancelled",
        "Failed",
        "Failure rate",
        "Cost",
        "Costliest line",
      ],
      weekly.map(({ runs, ...week }) => [
        key(week),
        runs.total,
        runs.cancelled,
        runs.failed,
        percent(ratio(runs.failed, runs.total - runs.cancelled)),
        dollars(runs.costUsd),
        costliestLine(runs.byLine),
      ]),
    ),
    "## Commits on the default branch",
    table(
      [
        "Week",
        "Lore",
        "Human",
        "Lore share",
        ...(withDb ? ["Blocked PR-hours"] : []),
      ],
      weekly.map(({ commits, blockedHours, ...week }) => [
        key(week),
        commits.lore,
        commits.human,
        percent(commits.loreShare),
        ...(withDb ? [hours(blockedHours)] : []),
      ]),
    ),
  ];
}

function listed(items, line) {
  const shown = items.slice(0, LISTED).map(line);
  const more = items.length - shown.length;

  return (
    [...shown, ...(more > 0 ? [`- … and ${more} more`] : [])].join("\n") ||
    "- none"
  );
}

function details(stats, withDb) {
  const { weekly, helped, blockers } = stats;
  const intros = weekly.flatMap((week) =>
    week.intros.map((entry) => ({ key: week.week.key, ...entry })),
  );

  return [
    trendLine(weekly),
    ...weeklyTables(weekly, withDb),
    "## What happened (weekly changelog)",
    listed(
      intros,
      (entry) => `- **${entry.key}** ${shortName(entry.repo)}: ${entry.intro}`,
    ),
    "## Helped",
    `Lore PRs merged (${helped.merged.length}), newest first:`,
    listed(
      [...helped.merged].reverse(),
      (pull) =>
        `- ${pullRef(pull)} ${pull.title} (${pull.hoursToMerge} h to merge)`,
    ),
    `Human PRs that changed after a Lore review asked for something (${helped.fixedAfterReview.length}):`,
    listed(
      helped.fixedAfterReview,
      (pull) => `- ${pullRef(pull)} ${pull.title}`,
    ),
    "## Blocked",
    "Most common failures of floor runs:",
    blockers.reasons.length === 0
      ? "- none"
      : table(
          ["Line", "Reason", "Runs"],
          blockers.reasons.map(({ line, reason, count }) => [
            line,
            reason.replaceAll("|", "\\|").replaceAll("\n", " "),
            count,
          ]),
        ),
    `Lore PRs closed without merging (${blockers.closedUnmerged.length}):`,
    listed(
      blockers.closedUnmerged,
      (pull) => `- ${pullRef(pull)} ${pull.title}`,
    ),
    ...(withDb
      ? [
          "PRs Lore held up longest (hours inside the window; rows go 30 days after a PR closes, so older weeks undercount):",
          listed(
            blockers.longestBlocked,
            (span) => `- ${pullRef(span)} ${span.reason} (${span.hours} h)`,
          ),
        ]
      : []),
  ];
}

export function renderReport(stats, weeks, { generatedAt, withDb = false }) {
  const first = weeks[0];
  const last = weeks.at(-1);

  return (
    [
      "# Lore on the Ole Larson repositories",
      `Weeks ${first.key} to ${last.key} (${first.from} to ${last.to}), generated ${generatedAt}. All repositories are pooled; a PR or run counts in the week it was opened. A run stopped on purpose (superseded by a push, its PR closed) counts as cancelled, outside the failure rate. Lore's PRs are those by lore-agent; Dependabot and other bots count on neither side.`,
      "## Summary",
      table(
        [
          "Repos",
          "Lore PRs merged",
          "Human PRs merged",
          "Lore share of merged",
          "Review coverage",
          "Fixed after review",
          "Run failure rate",
          "Floor cost",
          "Cost per merged Lore PR",
        ],
        [summaryRow(stats)],
      ),
      ...details(stats, withDb),
    ].join("\n\n") + "\n"
  );
}
