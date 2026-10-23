import { describe, it, expect } from "vitest";
import type { RepoLoop } from "@/lib/api/loops";
import type { CodeReview } from "@/lib/api/code-review";
import type { IssueTriage } from "@/lib/api/triage";
import {
  loopBoard,
  pausedNotice,
  mergeSections,
  reviewSections,
  triageSections,
  upkeepSections,
  type LoopRead,
} from "./board";

const loop = (key: RepoLoop["key"], label: string): RepoLoop => ({
  key,
  label,
  description: "",
  enabled: true,
});

const REVIEW = loop("review", "Code review");
const TRIAGE = loop("triage", "Issue triage");

const empty = {
  current: [],
  backlog: [],
  parked: [],
  awaiting_merge: [],
  recent: [],
};

const review = (over: Partial<CodeReview>): LoopRead => ({
  loop: REVIEW,
  sections: reviewSections(REVIEW, { ...empty, ...over }),
});

const triage = (over: Partial<IssueTriage>): LoopRead => ({
  loop: TRIAGE,
  sections: triageSections(TRIAGE, { ...empty, ...over }),
});

const pr = (n: number, created_at: string | null = null) => ({
  pr_number: n,
  pr_url: `https://github.com/acme/widgets/pull/${n}`,
  title: `Change ${n}`,
  draft: false,
  line: "review",
  state: "running",
  run_id: `run-${n}`,
  pipeline: [],
  created_at,
});

const issue = (n: number, created_at: string | null = null) => ({
  issue_number: n,
  issue_url: `https://github.com/acme/widgets/issues/${n}`,
  title: `Issue ${n}`,
  state: "diagnosed",
  run_id: `run-i${n}`,
  pipeline: [],
  created_at,
});

describe("loopBoard", () => {
  it("joins code review's and triage's Current rows into one Current, grouped by loop in the order the loops are read", () => {
    const board = loopBoard([
      review({ current: [pr(7), pr(8)] }),
      triage({ current: [issue(3)] }),
    ]);
    const current = board.sections.find((s) => s.key === "current");

    expect({
      headings: board.sections.map((s) => s.heading),
      current: current?.rows.map((r) => [r.loop.label, r.ref]),
      runIds: board.runIds,
    }).toEqual({
      headings: ["Current", "Backlog", "Recently addressed"],
      current: [
        ["Code review", "#7"],
        ["Code review", "#8"],
        ["Issue triage", "#3"],
      ],
      runIds: ["run-7", "run-8", "run-i3"],
    });
  });

  it("orders Recently addressed newest first across loops, a row with no time last", () => {
    const board = loopBoard([
      review({ recent: [pr(7, "2026-10-20T00:00:00Z"), pr(8, null)] }),
      triage({ recent: [issue(3, "2026-10-22T00:00:00Z")] }),
    ]);

    expect(
      board.sections.find((s) => s.key === "recent")?.rows.map((r) => r.ref),
    ).toEqual(["#3", "#7", "#8"]);
  });

  it("shows Parked and Awaiting merge only when a loop has a row there", () => {
    const board = loopBoard([review({ awaiting_merge: [pr(9)] })]);

    expect(board.sections.map((s) => s.key)).toEqual([
      "current",
      "backlog",
      "awaiting_merge",
      "recent",
    ]);
  });

  it("names a loop that could not be read and keeps the other loops' rows", () => {
    const board = loopBoard([
      {
        loop: REVIEW,
        sections: null,
        failure: "Could not load Code review (HTTP 502)",
      },
      triage({ backlog: [issue(4)] }),
    ]);

    expect({
      failures: board.failures,
      backlog: board.sections
        .find((s) => s.key === "backlog")
        ?.rows.map((r) => r.ref),
    }).toEqual({
      failures: ["Could not load Code review (HTTP 502)"],
      backlog: ["#4"],
    });
  });

  it("says above the Backlog which shown loops are switched off, and what fills an empty backlog for each", () => {
    const off = { ...loop("triage", "Issue triage"), enabled: false };
    const board = loopBoard([
      review({}),
      {
        loop: off,
        sections: triageSections(off, empty),
        backlogNotice: pausedNotice(off),
      },
    ]);
    const backlog = board.sections.find((s) => s.key === "backlog");

    expect({ notices: backlog?.notices, empty: backlog?.emptyText }).toEqual({
      notices: [
        "Paused: Issue triage is switched off. Nothing in its backlog is picked until it is switched on above.",
      ],
      empty:
        "The backlog is empty. Every open pull request no review has looked at waits here. Label an issue triage: needs-triage to have it triaged.",
    });
  });
});

describe("loop rows", () => {
  it("draws a review row as its pull request, tagged with its review line, and a triage row as its issue with its label as the state", () => {
    const [reviewRow] = reviewSections(REVIEW, {
      ...empty,
      parked: [{ ...pr(7), state: "changes_requested", line: "re-check" }],
    }).parked;
    const [triageRow] = triageSections(TRIAGE, {
      ...empty,
      parked: [{ ...issue(3), state: "needs-reproduction" }],
    }).parked;

    expect({
      review: [
        reviewRow.ref,
        reviewRow.url,
        reviewRow.prUrl,
        reviewRow.tag,
        reviewRow.state,
      ],
      triage: [triageRow.ref, triageRow.url, triageRow.prUrl, triageRow.state],
    }).toEqual({
      review: [
        "#7",
        "https://github.com/acme/widgets/pull/7",
        "https://github.com/acme/widgets/pull/7",
        "re-check",
        "changes_requested",
      ],
      triage: [
        "#3",
        "https://github.com/acme/widgets/issues/3",
        null,
        "needs-reproduction",
      ],
    });
  });

  it("draws an auto-merge row as its pull request, its blocked reason beside the title", () => {
    const MERGE = loop("merge", "Auto merge");
    const [row] = mergeSections(MERGE, {
      ...empty,
      parked: [
        {
          pr_number: 4,
          pr_url: "https://github.com/acme/widgets/pull/4",
          title: "Fix",
          state: "blocked",
          blocked: "Needs a code owner's approval",
          run_id: null,
          pipeline: null,
          created_at: null,
        },
      ],
    }).parked;

    expect([row.ref, row.state, row.tag, row.prUrl]).toEqual([
      "#4",
      "blocked",
      "Needs a code owner's approval",
      "https://github.com/acme/widgets/pull/4",
    ]);
  });

  it("draws an upkeep run as its day with why it stopped, and its open pull request as #40 linked to itself", () => {
    const UPKEEP = loop("upkeep", "Spec upkeep");
    const sections = upkeepSections(UPKEEP, {
      ...empty,
      parked: [
        {
          ref: "2026-10-19",
          url: null,
          title: "Spec upkeep",
          state: "failed",
          blocked: "ci stayed red",
          run_id: "run-1",
          pipeline: [],
          created_at: "2026-10-19T10:00:00Z",
        },
      ],
      awaiting_merge: [
        {
          ref: "#40",
          url: "https://github.com/acme/widgets/pull/40",
          title: "Spec upkeep",
          state: "awaiting review",
          blocked: null,
          run_id: null,
          pipeline: null,
          created_at: null,
        },
      ],
    });
    const [run] = sections.parked;
    const [pull] = sections.awaiting_merge;

    expect([
      [run.ref, run.tag, run.runId],
      [pull.ref, pull.prUrl],
    ]).toEqual([
      ["2026-10-19", "ci stayed red", "run-1"],
      ["#40", "https://github.com/acme/widgets/pull/40"],
    ]);
  });
});
