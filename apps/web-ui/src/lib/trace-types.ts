// Mirror of the spec-traceability /trace API JSON shapes. web-ui is not an npm
// workspace member, so it cannot import @re-cinq/lore-shared — these types are
// the single web-ui source of truth for the graph document/statement/link
// shapes, imported by the API client and the presentational adapters.

export type TraceStatementState = "tested" | "untested" | "narrative";

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
