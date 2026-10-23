import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorKind,
  blockers,
  helped,
  isoWeekKey,
  median,
  weeklyStats,
  windowWeeks,
} from "./weekly.mjs";

const WEEKS = windowWeeks("2026-10-23", 2);
const NOW = "2026-10-23T12:00:00Z";

const pull = (over) => ({
  number: 1,
  title: "A change",
  author: "saadahmed95",
  isBot: false,
  createdAt: "2026-10-19T08:00:00Z",
  mergedAt: null,
  closedAt: null,
  reviews: [],
  commitDates: [],
  ...over,
});

const raw = (over) => ({
  pulls: [],
  commits: [],
  runs: [],
  blocked: [],
  changelog: [],
  ...over,
});

const thisWeek = (over) => weeklyStats(raw(over), WEEKS, NOW)[1];

test("isoWeekKey puts Monday 2026-10-19 in 2026-W43", () => {
  assert.equal(isoWeekKey("2026-10-19T00:00:00Z"), "2026-W43");
});

test("isoWeekKey puts Sunday 2026-10-18 23:59 in 2026-W42", () => {
  assert.equal(isoWeekKey("2026-10-18T23:59:59Z"), "2026-W42");
});

test("isoWeekKey puts 2027-01-01 in 2026-W53", () => {
  assert.equal(isoWeekKey("2027-01-01T12:00:00Z"), "2026-W53");
});

test("windowWeeks of 2 ending 2026-10-23 returns W42 and W43 with their Monday-to-Sunday days", () => {
  assert.deepEqual(WEEKS, [
    { key: "2026-W42", from: "2026-10-12", to: "2026-10-18" },
    { key: "2026-W43", from: "2026-10-19", to: "2026-10-25" },
  ]);
});

test("authorKind returns lore for lore-agent, bot for dependabot and human for a person", () => {
  assert.deepEqual(
    [
      authorKind("lore-agent", true),
      authorKind("dependabot", true),
      authorKind("saadahmed95", false),
    ],
    ["lore", "bot", "human"],
  );
});

test("median of 1, 4, 2 and 10 returns 3", () => {
  assert.equal(median([1, 4, 2, 10]), 3);
});

test("median of nothing returns null", () => {
  assert.equal(median([]), null);
});

test("weeklyStats splits Lore pull requests into merged and closed unmerged with hours to merge", () => {
  const week = thisWeek({
    pulls: [
      pull({
        author: "lore-agent",
        isBot: true,
        mergedAt: "2026-10-19T18:00:00Z",
        closedAt: "2026-10-19T18:00:00Z",
      }),
      pull({
        number: 2,
        author: "lore-agent",
        isBot: true,
        closedAt: "2026-10-20T08:00:00Z",
      }),
      pull({ number: 3, mergedAt: "2026-10-19T12:00:00Z" }),
    ],
  });

  assert.deepEqual(week.pulls, {
    lore: { opened: 2, merged: 1, closedUnmerged: 1, medianHoursToMerge: 10 },
    human: { opened: 1, merged: 1, closedUnmerged: 0, medianHoursToMerge: 4 },
    loreShareOfMerged: 0.5,
  });
});

test("weeklyStats leaves a Dependabot pull request out of both Lore and human counts", () => {
  const week = thisWeek({
    pulls: [pull({ author: "dependabot", isBot: true })],
  });

  assert.equal(week.pulls.lore.opened + week.pulls.human.opened, 0);
});

test("weeklyStats counts a human pull request fixed after a Lore request for changes", () => {
  const week = thisWeek({
    pulls: [
      pull({
        reviews: [
          {
            author: "lore-agent",
            state: "CHANGES_REQUESTED",
            submittedAt: "2026-10-19T10:00:00Z",
          },
        ],
        commitDates: ["2026-10-19T07:00:00Z", "2026-10-19T11:00:00Z"],
      }),
      pull({ number: 2 }),
    ],
  });

  assert.deepEqual(week.reviews, {
    humanPulls: 2,
    reviewed: 1,
    coverage: 0.5,
    medianHoursToReview: 2,
    changesRequested: 1,
    fixedAfterReview: 1,
  });
});

test("weeklyStats sums runs, failures and cost per line", () => {
  const run = (over) => ({
    blueprint_name: "code-review",
    status: "finished",
    outcome: "success",
    reason: null,
    created_at: "2026-10-20T09:00:00Z",
    cost_usd: 0.25,
    ...over,
  });
  const week = thisWeek({
    runs: [
      run({}),
      run({ status: "failed", outcome: "error", cost_usd: 0.5 }),
      run({ blueprint_name: "implementation-loop", cost_usd: null }),
    ],
  });

  assert.deepEqual(week.runs, {
    total: 3,
    failed: 1,
    costUsd: 0.75,
    byLine: {
      "code-review": { runs: 2, failed: 1, costUsd: 0.75 },
      "implementation-loop": { runs: 1, failed: 0, costUsd: 0 },
    },
  });
});

test("weeklyStats counts a commit with a Lore-Task trailer as Lore's", () => {
  const week = thisWeek({
    commits: [
      {
        date: "2026-10-20T09:00:00Z",
        author: "gedaiu",
        message: "Fix\n\nLore-Task: 1234",
      },
      { date: "2026-10-20T10:00:00Z", author: "gedaiu", message: "Tweak" },
      {
        date: "2026-10-20T11:00:00Z",
        author: "lore-agent[bot]",
        message: "Add",
      },
      { date: "2026-10-20T12:00:00Z", author: "loredanamoanga", message: "UI" },
    ],
  });

  assert.deepEqual(week.commits, { lore: 2, human: 2, loreShare: 0.5 });
});

test("weeklyStats splits the hours a PR was blocked across the week boundary", () => {
  const weeks = weeklyStats(
    raw({
      blocked: [
        {
          pr_number: 7,
          reason: "ci_failing",
          since: "2026-10-18T20:00:00Z",
          closed_at: "2026-10-19T06:00:00Z",
        },
      ],
    }),
    WEEKS,
    NOW,
  );

  assert.deepEqual(
    weeks.map((week) => week.blockedHours),
    [4, 6],
  );
});

test("blockers ranks failure reasons by count and lists Lore PRs closed unmerged", () => {
  const failed = (reason) => ({
    blueprint_name: "implementation-loop",
    status: "failed",
    outcome: "error",
    reason,
    created_at: "2026-10-20T09:00:00Z",
  });
  const found = blockers(
    raw({
      runs: [failed("ci red"), failed("ci red"), failed("timeout")],
      pulls: [
        pull({
          number: 9,
          title: "Dropped",
          author: "lore-agent",
          isBot: true,
          closedAt: "2026-10-21T09:00:00Z",
        }),
      ],
      blocked: [
        {
          pr_number: 4,
          reason: "review_pending",
          since: "2026-10-19T00:00:00Z",
          closed_at: null,
        },
      ],
    }),
    WEEKS,
    NOW,
  );

  assert.deepEqual(found, {
    reasons: [
      { line: "implementation-loop", reason: "ci red", count: 2 },
      { line: "implementation-loop", reason: "timeout", count: 1 },
    ],
    closedUnmerged: [{ number: 9, title: "Dropped" }],
    longestBlocked: [{ number: 4, reason: "review_pending", hours: 108 }],
  });
});

test("helped lists merged Lore PRs and human PRs fixed after a Lore review", () => {
  const found = helped(
    raw({
      pulls: [
        pull({
          number: 5,
          title: "Loop fix",
          author: "lore-agent",
          isBot: true,
          mergedAt: "2026-10-19T10:00:00Z",
        }),
        pull({
          number: 6,
          title: "Human feature",
          reviews: [
            {
              author: "lore-agent",
              state: "COMMENTED",
              submittedAt: "2026-10-19T09:00:00Z",
            },
          ],
          commitDates: ["2026-10-19T09:30:00Z"],
        }),
      ],
    }),
    WEEKS,
  );

  assert.deepEqual(found, {
    merged: [{ number: 5, title: "Loop fix", hoursToMerge: 2 }],
    fixedAfterReview: [{ number: 6, title: "Human feature" }],
  });
});
