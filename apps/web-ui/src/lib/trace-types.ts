// Mirror of the spec-traceability /trace API JSON shapes. web-ui is not an npm
// workspace member, so it cannot import @re-cinq/lore-shared — these types are
// the single web-ui source of truth for the graph document/statement/link
// shapes, imported by the API client and the presentational adapters.
//
// DECISION (#1419): removable, but BLOCKED. lore-api serves /trace, so a
// generated type is reachable in principle — except one route serves eight kinds
// behind `TraceRead = z.record(z.unknown())`, so the generated type carries no
// field names at all. The unblock is to split /trace/{kind} into concrete paths
// (hapi prefers a literal segment over a param, so no URL and no caller changes)
// and declare each kind's shape.

export type TraceStatementState = "tested" | "untested" | "narrative";

/** A resolved `[label](path#Lline)` test link on a statement, the shape
 * `toStatementInfo` builds for SpecDetails. Mirrors shared `SpecLinkRef`
 * (libs/shared/src/spec-link-parser.ts). */
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
