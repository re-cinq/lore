import type { StatementInfo } from "@/app/repos/[owner]/[repo]/specs/SpecDetails";
import type { TraceLinkRef, TraceStatementState } from "@/lib/trace-types";

/** Graph statement this adapter consumes — the canonical {@link TraceLinkRef}
 * /state mirror plus the parser-supplied `kind`/`testability` fields. */
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

/** Maps graph statements → SpecDetails `StatementInfo`: fields straight
 * through, test-kind links only, drifted OR-folds violated. `category`
 * stays null until a later cycle derives it. */
export function toStatementInfo(statements: GraphStatement[]): StatementInfo[] {
  return statements.map((statement) => ({
    ordinal: statement.ordinal,
    text: statement.text,
    kind: statement.kind ?? "",
    state: statement.state,
    drifted: Boolean(statement.drifted || statement.violated),
    // Placeholders the type demands; later TDD cycles fill these in.
    category: null,
    testLinks: statement.links
      .filter((link) => link.kind === "test")
      .map((link) => ({
        label: link.label,
        path: link.path ?? "",
        line: link.line ?? null,
      })),
  }));
}
