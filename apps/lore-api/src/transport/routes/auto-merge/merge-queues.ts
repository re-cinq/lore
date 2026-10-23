// The auto-merge loop in the shared loop sections (specs/protected-branch-merge): Lore's own pull requests by whether GitHub's auto-merge is armed and what the stored blocked reason says. Pure, what the route read is handed in.
import { z } from "zod";
import { labelForReason } from "@re-cinq/lore-shared/blocked-reason.js";
import { loopRowFields, loopSectionsSchema } from "../loops/loop-sections.js";

export const MergeRowSchema = z.object({
  pr_number: z.number(),
  pr_url: z.string().nullable(),
  /** `state`: `armed` (GitHub merges it once the branch rule is met), `blocked` (a person must act), `open` (not armed yet), or `merged`. */
  ...loopRowFields,
  /** What holds the pull request, in words: the stored blocked reason's label. */
  blocked: z.string().nullable(),
});

/** Auto merge in the shared loop sections: Current, armed while CI or Lore's review still runs; Backlog, open and not armed yet; Parked, blocked on a person (an approval, a code owner, a conflict, a base behind, a PR it waits for, GitHub refusing); Awaiting merge, armed with nothing left to wait for; Recently addressed, Lore's pull requests merged in the last week. */
export const AutoMergeSchema = loopSectionsSchema(MergeRowSchema);

export type MergeRow = z.infer<typeof MergeRowSchema>;
export type AutoMerge = z.infer<typeof AutoMergeSchema>;

export interface MergePull {
  number: number;
  title: string;
  url: string;
  author?: string;
  autoMerge?: boolean;
  mergedAt?: string;
}

export interface StoredBlock {
  prNumber: number;
  reason: string;
  detail: string | null;
  since: string | null;
}

/** The reasons that wait on a machine, not a person: a pull request held by one is still moving. */
const MOVING: ReadonlySet<string> = new Set([
  "waiting_on_ci",
  "review_in_flight",
]);

const RECENT_LIMIT = 10;

export function mergeQueues(input: {
  open: readonly MergePull[];
  merged: readonly MergePull[];
  blocks: readonly StoredBlock[];
  appLogin: string | undefined;
}): AutoMerge {
  const { open, merged, blocks, appLogin } = input;
  const lores = (pull: MergePull) =>
    appLogin !== undefined && pull.author === appLogin;
  const rows = open.filter(lores).map((pull) => openRow(pull, blocks));

  return { ...openBuckets(rows), recent: recentRows(merged.filter(lores)) };
}

/** An open pull request by its state: armed and still moving, not armed yet, blocked on a person, or armed with nothing left to wait for. */
function openBuckets(rows: readonly MergeRow[]) {
  const armed = rows.filter((r) => r.state === "armed");

  return {
    current: armed.filter((r) => r.blocked !== null),
    backlog: rows.filter((r) => r.state === "open"),
    parked: rows.filter((r) => r.state === "blocked"),
    awaiting_merge: armed.filter((r) => r.blocked === null),
  };
}

function openRow(pull: MergePull, blocks: readonly StoredBlock[]): MergeRow {
  const block = blocks.find((b) => b.prNumber === pull.number);

  return {
    ...pullFields(pull),
    state: openState(pull, block),
    blocked: block ? labelForReason(block.reason, block.detail) : null,
    created_at: block?.since ?? null,
  };
}

/** Before Lore's review arms it, a pull request is supposed to lack its approval: that wait is the backlog, not a person's job. */
const AWAITING_ARM: ReadonlySet<string> = new Set([
  ...MOVING,
  "needs_approval",
  "needs_code_owner",
]);

/** Blocked on a person when the stored reason is not a wait the pull request is expected to be in; otherwise armed or not. */
function openState(pull: MergePull, block: StoredBlock | undefined): string {
  const expected = pull.autoMerge ? MOVING : AWAITING_ARM;

  if (block && !expected.has(block.reason)) {
    return "blocked";
  }

  return pull.autoMerge ? "armed" : "open";
}

function recentRows(merged: readonly MergePull[]): MergeRow[] {
  return [...merged]
    .sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? ""))
    .slice(0, RECENT_LIMIT)
    .map((pull) => ({
      ...pullFields(pull),
      state: "merged",
      blocked: null,
      created_at: pull.mergedAt ?? null,
    }));
}

function pullFields(pull: MergePull) {
  return {
    pr_number: pull.number,
    pr_url: pull.url,
    title: pull.title,
    run_id: null,
    pipeline: null,
  };
}
