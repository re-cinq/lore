// The auto-merge loop in the shared loop sections (specs/protected-branch-merge): every pull request the loop works or will work, by its run. Pure, what the route read is handed in.
import { z } from "zod";
import { labelForReason } from "@re-cinq/lore-shared/blocked-reason.js";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import { isOpenStatus } from "../../../work/floor/floor-run-query.js";
import { loopRowFields, loopSectionsSchema } from "../loops/loop-sections.js";

export const MergeRowSchema = z.object({
  pr_number: z.number(),
  pr_url: z.string().nullable(),
  /** `state`: `reviewed` (waiting for the loop), the run's status while it works, `armed` (approved, GitHub merging), `waiting` (only its minimum age is left), `blocked` (a person must act), or `merged`. */
  ...loopRowFields,
  /** What holds the pull request, in words: when it may merge, a stored blocked reason, or why the loop left it. */
  blocked: z.string().nullable(),
});

/** Auto merge in the shared loop sections: Current, a run is working it; Backlog, code review passed and no run yet; Parked, the run left it for a person or a blocked reason waits on one; Awaiting merge, approved and armed, or only its minimum age is left; Recently addressed, pull requests the loop worked that merged this week. */
export const AutoMergeSchema = loopSectionsSchema(MergeRowSchema);

export type MergeRow = z.infer<typeof MergeRowSchema>;
export type AutoMerge = z.infer<typeof AutoMergeSchema>;

export interface MergePull {
  number: number;
  title: string;
  url: string;
  createdAt?: string;
  mergedAt?: string;
}

export interface StoredBlock {
  prNumber: number;
  reason: string;
  detail: string | null;
}

export interface MergeQueuesInput {
  open: readonly MergePull[];
  /** Open pull requests whose code review passed: the loop's backlog. */
  reviewed: ReadonlySet<number>;
  /** The loop's newest runs, any status. */
  runs: readonly FloorRunRow[];
  merged: readonly MergePull[];
  blocks: readonly StoredBlock[];
  minAgeHours: number;
  now: number;
}

const HOUR_MS = 60 * 60 * 1000;
const RECENT_LIMIT = 10;

/** The reasons a person must act on; the others are waits the loop handles. */
const ON_A_PERSON: ReadonlySet<string> = new Set([
  "needs_code_owner",
  "merge_conflict",
  "blocked_by_pr",
  "github_refused",
  "required_check_missing",
]);

export function mergeQueues(input: MergeQueuesInput): AutoMerge {
  const rows = input.open.map((pull) => openRow(pull, input));

  return {
    current: inState(rows, (state) => isOpenStatus(state)),
    backlog: inState(rows, (state) => state === "reviewed"),
    parked: inState(rows, (state) => state === "blocked"),
    awaiting_merge: inState(
      rows,
      (state) => state === "armed" || state === "waiting",
    ),
    recent: recentRows(input),
  };
}

function inState(
  rows: readonly (MergeRow | null)[],
  wanted: (state: string) => boolean,
): MergeRow[] {
  return rows.filter(
    (row): row is MergeRow => row !== null && wanted(row.state),
  );
}

/** An open pull request by its newest run: none yet, still working, waiting out its age, armed, or left for a person. Null when the loop has no business with it. */
function openRow(pull: MergePull, input: MergeQueuesInput): MergeRow | null {
  const run = newestRunFor(pull.url, input.runs);
  const block = input.blocks.find((b) => b.prNumber === pull.number);

  if (!run) {
    return input.reviewed.has(pull.number)
      ? row(pull, { state: "reviewed", blocked: null })
      : null;
  }

  if (isOpenStatus(run.status)) {
    return openRunRow(pull, { run, block }, input);
  }

  return settledRunRow(pull, run, block);
}

/** A run waiting at its gate with only the minimum age left reads as awaiting merge, with when it may merge; one still held by a stored reason (CI, review, a conflict) is still being worked, and says why. */
function openRunRow(
  pull: MergePull,
  { run, block }: { run: FloorRunRow; block: StoredBlock | undefined },
  input: MergeQueuesInput,
): MergeRow {
  const mergesAt = mergeTime(pull, input);

  const young = mergesAt !== null && mergesAt > input.now;
  const onlyAgeLeft = !block && atGate(run) && young;

  if (onlyAgeLeft) {
    return row(pull, {
      state: "waiting",
      blocked: `merges after ${isoMinute(mergesAt)}`,
      run,
    });
  }

  return row(pull, { state: run.status, blocked: blockLabel(block), run });
}

function atGate(run: FloorRunRow): boolean {
  return run.pipeline.some(
    (node) => node.node_id === "await-merge" && node.state === "waiting",
  );
}

function blockLabel(block: StoredBlock | undefined): string | null {
  return block ? labelForReason(block.reason, block.detail) : null;
}

function settledRunRow(
  pull: MergePull,
  run: FloorRunRow,
  block: StoredBlock | undefined,
): MergeRow {
  const personBlock = personBlockOf(block);

  if (run.outcome === "success" && !personBlock) {
    return row(pull, { state: "armed", blocked: null, run });
  }

  return row(pull, {
    state: "blocked",
    blocked: personBlock ?? run.reason ?? "the loop could not finish it",
    run,
  });
}

/** The blocked label's reason when it waits on a person; a block the loop itself clears is not one. */
function personBlockOf(block: StoredBlock | undefined): string | null {
  return block && ON_A_PERSON.has(block.reason)
    ? labelForReason(block.reason, block.detail)
    : null;
}

function recentRows(input: MergeQueuesInput): MergeRow[] {
  const worked = new Set(input.runs.map((run) => run.pr_url));
  const loopMerged = input.merged.filter((pull) => worked.has(pull.url));

  return newestMergedFirst(loopMerged)
    .slice(0, RECENT_LIMIT)
    .map((pull) => mergedRow(pull, input.runs));
}

function newestMergedFirst(pulls: readonly MergePull[]): MergePull[] {
  return [...pulls].sort((a, b) =>
    (b.mergedAt ?? "").localeCompare(a.mergedAt ?? ""),
  );
}

function mergedRow(pull: MergePull, runs: readonly FloorRunRow[]): MergeRow {
  const run = newestRunFor(pull.url, runs);

  return {
    ...row(pull, { state: "merged", blocked: null, run }),
    created_at: pull.mergedAt ?? null,
  };
}

function newestRunFor(
  url: string,
  runs: readonly FloorRunRow[],
): FloorRunRow | undefined {
  return runs
    .filter((run) => run.pr_url === url)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .at(0);
}

function mergeTime(pull: MergePull, input: MergeQueuesInput): number | null {
  return pull.createdAt
    ? Date.parse(pull.createdAt) + input.minAgeHours * HOUR_MS
    : null;
}

function isoMinute(time: number): string {
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function row(
  pull: MergePull,
  fields: { state: string; blocked: string | null; run?: FloorRunRow },
): MergeRow {
  return {
    pr_number: pull.number,
    pr_url: pull.url,
    title: pull.title,
    state: fields.state,
    blocked: fields.blocked,
    ...runFields(fields.run, pull),
  };
}

function runFields(
  run: FloorRunRow | undefined,
  pull: MergePull,
): Pick<MergeRow, "run_id" | "pipeline" | "created_at"> {
  if (!run) {
    return { run_id: null, pipeline: null, created_at: pull.createdAt ?? null };
  }

  return { run_id: run.id, pipeline: run.pipeline, created_at: run.created_at };
}
