import type { StatementInfo } from "./trace-types";
import type { TraceLinkRef, TraceStatementState } from "@/lib/trace-types";

/** Graph statement with TraceLinkRef/state + parser-supplied kind/testability. */
export interface GraphStatement {
  ordinal: number;
  text: string;
  kind?: string;
  testability?: string;
  state: TraceStatementState;
  links: TraceLinkRef[];
  drifted?: boolean;
  violated?: boolean;
}

// The content hash a label ends with, inside a closing code span or not: shared's spec-link-parser grammar.
const HASHED_LABEL = /@([0-9a-f]{8})`?$/;

/** Maps graph statements to SpecDetails StatementInfo (test-kind links only). */
export function toStatementInfo(statements: GraphStatement[]): StatementInfo[] {
  return statements.map((statement) => statementInfo(statement));
}

function statementInfo(statement: GraphStatement): StatementInfo {
  const testLinks = statement.links.filter((link) => link.kind === "test");

  return {
    ordinal: statement.ordinal,
    text: statement.text,
    kind: statement.kind ?? "",
    state: statement.state,
    drifted: Boolean(statement.drifted || statement.violated),
    category: statement.testability ?? null,
    testLinks: testLinks.map((link) => ({
      label: link.label,
      path: link.path ?? "",
      line: link.line ?? null,
      hash: HASHED_LABEL.exec(link.label)?.[1] ?? null,
    })),
  };
}
