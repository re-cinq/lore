// Issue triage in the sections every loop answers (specs/issue-triage FR28): pure, what the route read is handed in.
import { z } from "zod";
import { PipelineNodeSchema } from "../../../work/assembly-line-station/mini-pipeline.js";

export const TriageRowSchema = z.object({
  issue_number: z.number(),
  issue_url: z.string().nullable(),
  title: z.string(),
  /** The issue's triage label without its `triage: ` prefix, or `triaging` for an issue a run took up before it was labelled. */
  state: z.string(),
  run_id: z.string().nullable(),
  pipeline: z.array(PipelineNodeSchema).nullable(),
  created_at: z.string().nullable(),
});

export const IssueTriageSchema = z.object({
  /** Issues a triage run is working right now. */
  current: z.array(TriageRowSchema),
  /** `triage: needs-triage`, waiting for the sweep. */
  backlog: z.array(TriageRowSchema),
  /** Triage stopped on something a person must answer: a reproduction, a failure, a skip. */
  parked: z.array(TriageRowSchema),
  /** Triage never has a pull request to merge; always empty, so every loop answers the same sections. */
  awaiting_merge: z.array(TriageRowSchema),
  /** `triage: needs-priority`: triage is done and the issue waits for a priority label. */
  recent: z.array(TriageRowSchema),
});

export type TriageRow = z.infer<typeof TriageRowSchema>;
export type IssueTriage = z.infer<typeof IssueTriageSchema>;

export interface TriageIssue {
  number: number;
  title: string;
  url?: string;
  labels?: string[];
  createdAt?: string;
}

/** An open issue-triage run, by the issue it was started for. */
export interface TriageRun {
  id: string;
  issueNumber: string | undefined;
  pipeline: z.infer<typeof PipelineNodeSchema>[];
}

const TRIAGE_PREFIX = "triage: ";

export function triageBuckets(
  issues: readonly TriageIssue[],
  openRuns: readonly TriageRun[],
): IssueTriage {
  const rows = issues
    .map((issue) => triageRow(issue, openRuns))
    .filter((row): row is TriageRow => row !== null);
  const idle = rows.filter((row) => row.run_id === null);

  return {
    current: rows.filter((row) => row.run_id !== null),
    backlog: idle.filter((row) => row.state === "needs-triage"),
    parked: idle.filter((row) => !SETTLED_ELSEWHERE.has(row.state)),
    awaiting_merge: [],
    recent: idle.filter((row) => row.state === "needs-priority"),
  };
}

/** The idle states that are not parked: still to do, or done. */
const SETTLED_ELSEWHERE = new Set(["needs-triage", "needs-priority"]);

/** An issue is triage's when it carries a triage label or a triage run is open on it. */
function triageRow(
  issue: TriageIssue,
  openRuns: readonly TriageRun[],
): TriageRow | null {
  const state = triageState(issue.labels ?? []);
  const run = openRuns.find((r) => r.issueNumber === String(issue.number));

  if (!state && !run) {
    return null;
  }

  return {
    ...issueFields(issue),
    state: state ?? "triaging",
    ...runFields(run),
  };
}

function runFields(run: TriageRun | undefined) {
  return run
    ? { run_id: run.id, pipeline: run.pipeline }
    : { run_id: null, pipeline: null };
}

/** The issue's triage label without its prefix, absent when it carries none. */
function triageState(labels: readonly string[]): string | undefined {
  const label = labels.find((l) => l.startsWith(TRIAGE_PREFIX));

  return label?.slice(TRIAGE_PREFIX.length);
}

function issueFields(issue: TriageIssue) {
  return {
    issue_number: issue.number,
    issue_url: issue.url ?? null,
    title: issue.title,
    created_at: issue.createdAt ?? null,
  };
}
