// Spec-traceability /trace API JSON shapes (web-ui source of truth; #1419: generate when /trace/{kind} lands).

export type TraceStatementState = "tested" | "untested" | "narrative";

/** Resolved test link on a statement (mirrors shared SpecLinkRef). */
export interface TestLinkRef {
  label: string;
  /** Repo-relative file path, leading slash stripped. */
  path: string;
  /** Line number from a `#L42` anchor, or null when absent. */
  line: number | null;
}

export interface TraceLinkRef {
  kind: "test" | "code" | "adr";
  label: string;
  path?: string;
  line?: number;
  detail?: string;
}

export interface TraceSection {
  uid: string;
  heading: string;
  ordinal: number;
  level?: number;
}

export interface TraceStatement {
  uid: string;
  ordinal: number;
  text: string;
  state: TraceStatementState;
  sectionUid?: string;
  links: TraceLinkRef[];
  drifted?: boolean;
  violated?: boolean;
}

export interface TraceCoverage {
  testable: number;
  covered: number;
  untestable: number;
  ratio: number;
}

export interface TraceDocument {
  filePath: string;
  sections: TraceSection[];
  statements: TraceStatement[];
  coverage: TraceCoverage;
}

export type StatementState = "tested" | "untested" | "narrative";

export interface StatementInfo {
  ordinal: number;
  text: string;
  kind: string;
  state: StatementState;
  /** Untestable category (intro / vision / limitation / etc.); null for testable. */
  category: string | null;
  /** Parsed test links from the trailing parenthetical; empty for non-tested states. */
  testLinks: TestLinkRef[];
  /** Graph-sourced — the statement's graph node is violated/drifted. */
  drifted?: boolean;
}
