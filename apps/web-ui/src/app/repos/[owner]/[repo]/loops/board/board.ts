// The Loops tab's board (specs/implementation-loop FR9): every shown loop's rows in one set of shared sections. Pure: the reads are handed in.
import type { PipelineNode } from "@/lib/assembly-run-rows";
import type { ImplementationLoop, LoopTicket } from "@/lib/api/backlog";
import type { AutoMerge, MergeRow } from "@/lib/api/auto-merge";
import type { CodeReview, ReviewRow } from "@/lib/api/code-review";
import type { RepoLoop } from "@/lib/api/loops";
import type { IssueTriage, TriageRow } from "@/lib/api/triage";
import type { SpecUpkeep, UpkeepRow } from "@/lib/api/spec-upkeep";
import type { DailyDigest, DigestRow } from "@/lib/api/daily-digest";

export const SECTION_KEYS = [
  "current",
  "backlog",
  "parked",
  "awaiting_merge",
  "recent",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type Hold = NonNullable<LoopTicket["hold"]>;

/** One piece of work any loop shows: an issue or a pull request. */
export interface BoardRow {
  loop: Pick<RepoLoop, "key" | "label">;
  /** `#7`. */
  ref: string;
  title: string;
  url: string | null;
  state: string;
  since: string | null;
  runId: string | null;
  pipeline: readonly PipelineNode[] | null;
  prUrl: string | null;
  /** A word beside the title: the ticket's priority label, or which review line a run belongs to. */
  tag: string | null;
  hold: Hold | null;
}

export type LoopSections = Record<SectionKey, BoardRow[]>;

/** One shown loop's read: its rows in the shared sections, or why they could not be read. */
export interface LoopRead {
  loop: RepoLoop;
  sections: LoopSections | null;
  failure?: string;
  /** What holds the loop's whole backlog, said once above the rows. */
  backlogNotice?: string;
}

export interface BoardSection {
  key: SectionKey;
  heading: string;
  rows: BoardRow[];
  emptyText: string;
  notices: string[];
}

export interface Board {
  sections: BoardSection[];
  failures: string[];
  /** Every run a row shows Stages for, for the live follower. */
  runIds: string[];
}

const HEADINGS: Record<SectionKey, string> = {
  current: "Current",
  backlog: "Backlog",
  parked: "Parked",
  awaiting_merge: "Awaiting merge",
  recent: "Recently addressed",
};

/** Sections absent entirely when they would hold nothing. */
const OPTIONAL: ReadonlySet<SectionKey> = new Set(["parked", "awaiting_merge"]);

/** What puts work in each loop's backlog, said when the backlog is empty. */
const BACKLOG_HINT: Record<string, string> = {
  implementation:
    "Label an issue priority:high, priority:medium, or priority:low to queue it.",
  review: "Every open pull request no review has looked at waits here.",
  merge:
    "Every open pull request Lore's review approved waits here until the auto-merge loop takes it.",
  triage: "Label an issue triage: needs-triage to have it triaged.",
  upkeep: "Spec upkeep has no backlog: it runs every Monday.",
  digest: "The daily digest has no backlog: it posts on its schedule.",
};

export function loopBoard(reads: readonly LoopRead[]): Board {
  const sections = SECTION_KEYS.map((key) => boardSection(key, reads)).filter(
    (section) => !OPTIONAL.has(section.key) || section.rows.length > 0,
  );

  return {
    sections,
    failures: reads.flatMap((read) => (read.failure ? [read.failure] : [])),
    runIds: [
      ...new Set(
        sections.flatMap((s) =>
          s.rows.flatMap((r) => (r.runId ? [r.runId] : [])),
        ),
      ),
    ],
  };
}

function boardSection(
  key: SectionKey,
  reads: readonly LoopRead[],
): BoardSection {
  const rows = reads.flatMap((read) => read.sections?.[key] ?? []);

  return {
    key,
    heading: HEADINGS[key],
    rows: key === "recent" ? newestFirst(rows) : rows,
    emptyText: emptyText(key, reads),
    notices:
      key === "backlog"
        ? reads.flatMap((r) => (r.backlogNotice ? [r.backlogNotice] : []))
        : [],
  };
}

/** Recently addressed across loops reads newest first; a row with no time goes last. */
function newestFirst(rows: readonly BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
}

/** Each empty text says what would put work here rather than just "none": an empty section usually means the reader has something to do. */
function emptyText(key: SectionKey, reads: readonly LoopRead[]): string {
  if (key === "current") {
    return "Nothing is being worked right now.";
  }

  if (key === "backlog") {
    return [
      "The backlog is empty.",
      ...reads.map((r) => BACKLOG_HINT[r.loop.key]),
    ]
      .filter(Boolean)
      .join(" ");
  }

  return "Nothing addressed yet.";
}

/** Says once above the backlog that nothing in it is picked while the loop is off. */
export function pausedNotice(loop: RepoLoop): string | undefined {
  if (loop.enabled) {
    return undefined;
  }

  return NO_BACKLOG.has(loop.key)
    ? `Paused: ${loop.label} is switched off. It starts no run until it is switched on above.`
    : `Paused: ${loop.label} is switched off. Nothing in its backlog is picked until it is switched on above.`;
}

/** Loops that run on a schedule rather than take work from a backlog. */
const NO_BACKLOG: ReadonlySet<string> = new Set(["upkeep", "digest"]);

/** The implementation loop's backlog notice. An enabled loop waiting for its onboarding says so in the onboarding banner above the board, with the action that moves it on, so the backlog does not repeat it. */
export function implementationNotice(loop: RepoLoop): string | undefined {
  return pausedNotice(loop);
}

export function implementationSections(
  loop: RepoLoop,
  backlog: ImplementationLoop,
): LoopSections {
  return mapSections(
    { ...backlog, backlog: backlog.next },
    (ticket: LoopTicket) => ticketRow(loop, ticket),
  );
}

function ticketRow(loop: RepoLoop, ticket: LoopTicket): BoardRow {
  return {
    loop,
    ref: `#${ticket.issue_number}`,
    title: ticket.title,
    url: ticket.issue_url,
    state: ticket.state,
    since: ticket.created_at,
    runId: ticket.run_id,
    pipeline: ticket.pipeline,
    prUrl: ticket.pr_url,
    tag: ticket.priority,
    hold: ticket.hold,
  };
}

export function reviewSections(
  loop: RepoLoop,
  queues: CodeReview,
): LoopSections {
  return mapSections(queues, (row: ReviewRow) => ({
    loop,
    ref: row.pr_number ? `#${row.pr_number}` : "",
    title: row.title,
    url: row.pr_url,
    state: row.state,
    since: row.created_at,
    runId: row.run_id,
    pipeline: row.pipeline,
    prUrl: row.pr_url,
    tag: row.line,
    hold: null,
  }));
}

export function mergeSections(loop: RepoLoop, merge: AutoMerge): LoopSections {
  return mapSections(merge, (row: MergeRow) => ({
    loop,
    ref: `#${row.pr_number}`,
    title: row.title,
    url: row.pr_url,
    state: row.state,
    since: row.created_at,
    runId: row.run_id,
    pipeline: row.pipeline,
    prUrl: row.pr_url,
    tag: row.blocked,
    hold: null,
  }));
}

export function triageSections(
  loop: RepoLoop,
  triage: IssueTriage,
): LoopSections {
  return mapSections(triage, (row: TriageRow) => ({
    loop,
    ref: `#${row.issue_number}`,
    title: row.title,
    url: row.issue_url,
    state: row.state,
    since: row.created_at,
    runId: row.run_id,
    pipeline: row.pipeline,
    prUrl: null,
    tag: null,
    hold: null,
  }));
}

export function upkeepSections(
  loop: RepoLoop,
  upkeep: SpecUpkeep,
): LoopSections {
  return mapSections(upkeep, (row: UpkeepRow) => ({
    loop,
    ref: row.ref,
    title: row.title,
    url: row.url,
    state: row.state,
    since: row.created_at,
    runId: row.run_id,
    pipeline: row.pipeline,
    prUrl: row.url,
    tag: row.blocked,
    hold: null,
  }));
}

export function digestSections(
  loop: RepoLoop,
  digest: DailyDigest,
): LoopSections {
  return mapSections(digest, (row: DigestRow) => ({
    loop,
    ref: row.ref,
    title: row.title,
    url: null,
    state: row.state,
    since: row.created_at,
    runId: row.run_id,
    pipeline: row.pipeline,
    prUrl: null,
    tag: null,
    hold: null,
  }));
}

function mapSections<Row>(
  buckets: Record<SectionKey, Row[]>,
  toRow: (row: Row) => BoardRow,
): LoopSections {
  return Object.fromEntries(
    SECTION_KEYS.map((key) => [key, buckets[key].map(toRow)]),
  ) as LoopSections;
}
