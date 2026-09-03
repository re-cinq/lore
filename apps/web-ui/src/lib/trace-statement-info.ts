import type { StatementInfo } from "@/app/repos/[owner]/[repo]/specs/SpecDetails";
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

/** Maps graph statements to SpecDetails StatementInfo (test-kind links only). */
export function toStatementInfo(statements: GraphStatement[]): StatementInfo[] {
  return statements.map((statement) => ({
    ordinal: statement.ordinal,
    text: statement.text,
    kind: statement.kind ?? "",
    state: statement.state,
    drifted: Boolean(statement.drifted || statement.violated),
    category: null, // Placeholder; later cycles fill it in.
    testLinks: statement.links
      .filter((link) => link.kind === "test")
      .map((link) => ({
        label: link.label,
        path: link.path ?? "",
        line: link.line ?? null,
      })),
  }));
}
