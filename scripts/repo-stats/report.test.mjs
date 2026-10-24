import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, trend } from "./report.mjs";
import {
  blockers,
  combine,
  helped,
  weeklyStats,
  windowWeeks,
} from "./weekly.mjs";

const WEEKS = windowWeeks("2026-10-23", 2);
const NOW = "2026-10-23T12:00:00Z";

const lorePull = {
  number: 5,
  title: "Loop fix",
  author: "lore-agent",
  isBot: true,
  createdAt: "2026-10-19T08:00:00Z",
  mergedAt: "2026-10-19T10:00:00Z",
  closedAt: "2026-10-19T10:00:00Z",
  reviews: [],
  commitDates: [],
};

const humanPull = {
  ...lorePull,
  number: 6,
  title: "Human feature",
  author: "saadahmed95",
  isBot: false,
  createdAt: "2026-10-13T08:00:00Z",
  mergedAt: "2026-10-13T12:00:00Z",
};

const otto = {
  repo: "re-cinq/otto",
  pulls: [lorePull, humanPull],
  commits: [],
  runs: [
    {
      blueprint_name: "implementation-loop",
      status: "failed",
      outcome: "error",
      reason: "ci red",
      created_at: "2026-10-20T09:00:00Z",
      cost_usd: 1.5,
    },
  ],
  blocked: [],
  changelog: [{ weekKey: "2026-W43", intro: "The loop shipped a fix." }],
};

const statsOf = (raws) => {
  const raw = combine(raws);

  return {
    repos: raws.map(({ repo }) => repo),
    weekly: weeklyStats(raw, WEEKS, NOW),
    helped: helped(raw, WEEKS),
    blockers: blockers(raw, WEEKS, NOW),
  };
};

const hal = {
  ...otto,
  repo: "re-cinq/HALEngine",
  pulls: [{ ...lorePull, number: 7, title: "HAL fix" }],
  runs: [],
  changelog: [],
};

const report = (options = {}) =>
  renderReport(statsOf([otto, hal]), WEEKS, {
    generatedAt: NOW,
    ...options,
  });

test("renderReport summarises each repo in one row of the summary table", () => {
  assert.match(
    report(),
    /\| otto, HALEngine \| 2 \| 1 \| 67% \| 0% \| 0 \| 100% \| \$1\.50 \| \$0\.75 \|/,
  );
});

test("renderReport prints a dash, not $0.00, for a repo whose runs carry no cost", () => {
  const markdown = renderReport(statsOf([{ ...otto, runs: [] }]), WEEKS, {
    generatedAt: NOW,
  });

  assert.match(markdown, /\| — \| — \| — \|\n/);
});

test("renderReport writes one pull-request row per week with a dash where nothing merged", () => {
  assert.match(
    report(),
    /\| 2026-W42 \| 0 \| 0 \| 0 \| — \| 1 \| 1 \| 4\.0 \| 0% \|/,
  );
});

test("renderReport lists a merged Lore PR with its hours to merge under Helped", () => {
  assert.match(report(), /- otto#5 Loop fix \(2 h to merge\)/);
});

test("renderReport ranks the failure reason under Blocked", () => {
  assert.match(report(), /\| implementation-loop \| ci red \| 1 \|/);
});

test("renderReport quotes the changelog introduction of its week", () => {
  assert.match(report(), /- \*\*2026-W43\*\* otto: The loop shipped a fix\./);
});

test("renderReport leaves the blocked-hours column out without the database", () => {
  assert.doesNotMatch(report(), /Blocked PR-hours/);
});

test("renderReport adds the blocked-hours column with the database", () => {
  assert.match(report({ withDb: true }), /Blocked PR-hours/);
});

test("trend of Lore's merged share returns 0% in the first half and 50% in the second", () => {
  const weekly = weeklyStats(
    {
      ...combine([otto]),
      pulls: [
        lorePull,
        humanPull,
        { ...humanPull, createdAt: lorePull.createdAt },
      ],
    },
    WEEKS,
    NOW,
  );

  assert.deepEqual(
    trend(
      weekly,
      (week) => week.pulls.lore.merged,
      (week) => week.pulls.lore.merged + week.pulls.human.merged,
    ),
    { before: 0, after: 0.5 },
  );
});
