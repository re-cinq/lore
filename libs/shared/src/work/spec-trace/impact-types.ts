/** trace-impact's wire shapes: the diff description a client sends in, and the report + PR-comment/annotation shapes computed from it. */

import type { ImpactStatement } from "./impact-statement.js";

export type {
  ImpactStatement,
  Evidence,
  ChangeKind,
} from "./impact-statement.js";

/** One changed file: `ranges` are new-side intervals (coupling), `deleted` are old-side intervals removed (orphan detection). */
export interface ChangedRange {
  path: string;
  ranges: [number, number][];
  deleted?: [number, number][];
  /** Old-side intervals of every hunk, in graph coordinates; absent from protocol-1 clients. */
  baseRanges?: [number, number][];
  /** True only when the file is byte-identical at the graph baseline and the diff base, so `baseRanges` lines up with graph coordinates. */
  aligned?: boolean;
}

/** Why a file or a whole run contributed no line-precise finding. */
export type SkipReason = "unaligned" | "no-baseline" | "legacy-client";

/** A statement whose only coverage the diff deletes. */
export interface OrphanStatement {
  specPath: string;
  specTitle: string;
  statementText: string;
  statementAnchor: string;
  wasCoveredBy: string;
}

/** The head content of a changed spec/ADR, sent by the client (no GitHub round-trip, works on fork PRs). */
export interface ChangedDoc {
  path: string;
  content: string;
}

export interface ImpactOptions {
  /** Head content of changed spec/ADR files, for the statement-identity diff. */
  docs?: ChangedDoc[];
  /** Wire-format the client speaks; protocol 1 (or absent) diffed against the base-branch tip, not the merge base, so its findings are suppressed rather than published. */
  protocol?: number;
}

export interface ImpactReport {
  status: "ok" | "unavailable";
  /** Client wire-format, echoed so the comment can explain a suppressed run. */
  protocol?: number;
  /** Whether line-precise lookups could be trusted for every examined file. */
  coordinates?: "aligned" | "unverified";
  skipped?: { path: string; reason: SkipReason }[];
  statements: ImpactStatement[];
  orphaned: OrphanStatement[];
  testSelectors: string[];
  /** Commit the graph's line ranges are expressed in; absent when never stamped. */
  graphCommit?: string;
  /** ISO-8601 timestamp of that stamp. */
  graphCommitAt?: string;
  /** What the check actually looked at, so the comment can say so instead of implying a clean bill of health. */
  examined?: {
    files: number;
    withGraphData: number;
    docs: number;
    /** Statements present in a changed spec that the graph has never seen. */
    newStatements: number;
    /** Statements the diff changed that no test validated — counted, not listed. */
    changedWithoutTests: number;
  };
}

/** A GitHub Checks API annotation anchored to a changed line range. */
export interface ImpactAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "warning" | "notice";
  title: string;
  message: string;
}
