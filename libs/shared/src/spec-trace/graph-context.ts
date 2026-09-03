/**
 * graph-context-assembly — pure projection of the spec-traceability graph into a
 * ranked, deduplicated, budget-capped context block. Given the spec Statements
 * coupled to a task (already resolved by the seed-expansion query), ranks them by
 * signal (violated > drifted > untested > normal) and surfaces the distinct ADR
 * rationale + test selectors to hydrate alongside them. Deterministic, zero-LLM —
 * the I/O wrapper runs the DQL, this function is the projection of its result.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

export type GraphSignal = "violated" | "drifted" | "untested" | "normal";

export interface GraphContextStatement {
  xid: string;
  specPath: string;
  specTitle: string;
  section?: string;
  statementText: string;
  signal: GraphSignal;
  adrs: { label: string; path: string }[];
  testSelectors: string[];
}

export interface GraphContextBlock {
  statements: GraphContextStatement[];
  adrRefs: string[];
  testSelectors: string[];
  truncated: boolean;
}

interface StmtRow {
  uid: string;
  "Statement.xid"?: string;
  "Statement.text"?: string;
  "Statement.testability"?: string;
  "Statement.drifted"?: boolean;
  "Statement.violated"?: boolean;
  spec?: { "Spec.file_path"?: string; "Spec.title"?: string };
  section?: { "Section.heading"?: string };
  vb?: Array<{
    "TestChunk.file_path"?: string;
    "TestChunk.test_name"?: string;
    "TestChunk.start_line"?: number;
  }>;
  db?: Array<{ "ADR.file_path"?: string }>;
}

export interface GraphContextResult {
  q?: StmtRow[];
}

const SIGNAL_RANK: Record<GraphSignal, number> = {
  violated: 0,
  drifted: 1,
  untested: 2,
  normal: 3,
};

/** The highest-priority condition a statement meets: violated > drifted > untested > normal. */
function signalOf(row: StmtRow): GraphSignal {
  if (row["Statement.violated"]) {
    return "violated";
  }

  if (row["Statement.drifted"]) {
    return "drifted";
  }
  const tests = row.vb ?? [];

  if (row["Statement.testability"] !== "untestable" && tests.length === 0) {
    return "untested";
  }

  return "normal";
}

/** "adrs/ADR-016-dark.md" → "ADR-016" (the zero-padded id the path carries); basename otherwise. */
function adrLabel(path: string): string {
  const base = path.split("/").pop() ?? path;

  return base.match(/^ADR-\d+/i)?.[0] ?? base.replace(/\.md$/, "");
}

function adrsOf(row: StmtRow): GraphContextStatement["adrs"] {
  const seen = new Set<string>();
  const adrs: GraphContextStatement["adrs"] = [];

  for (const a of row.db ?? []) {
    const path = a["ADR.file_path"];

    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    adrs.push({ label: adrLabel(path), path });
  }

  return adrs;
}

function testSelectorsOf(row: StmtRow): string[] {
  const seen = new Set<string>();

  for (const t of row.vb ?? []) {
    const path = t["TestChunk.file_path"];

    if (path) {
      seen.add(path);
    }
  }

  return [...seen];
}

function toStatement(row: StmtRow): GraphContextStatement {
  return {
    xid: row["Statement.xid"] ?? row.uid,
    specPath: row.spec?.["Spec.file_path"] ?? "",
    specTitle: row.spec?.["Spec.title"] ?? "",
    section: row.section?.["Section.heading"],
    statementText: (row["Statement.text"] ?? "").trim(),
    signal: signalOf(row),
    adrs: adrsOf(row),
    testSelectors: testSelectorsOf(row),
  };
}

/** Distinct values across statements in first-appearance order. */
function distinct(
  statements: GraphContextStatement[],
  pick: (s: GraphContextStatement) => string[],
): string[] {
  return [...new Set(statements.flatMap(pick))];
}

/** Default budget cap on ranked statements — a token-budget proxy for the assembled block. */
export const DEFAULT_LIMIT = 12;

export function assembleGraphContext(
  data: GraphContextResult,
  opts: { limit?: number } = {},
): GraphContextBlock {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const byXid = new Map<string, GraphContextStatement>();

  for (const row of data.q ?? []) {
    const stmt = toStatement(row);

    if (!byXid.has(stmt.xid)) {
      byXid.set(stmt.xid, stmt);
    }
  }
  const ranked = [...byXid.values()].sort(
    (a, b) => SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal],
  );
  const statements = ranked.slice(0, limit);

  return {
    statements,
    adrRefs: distinct(statements, (s) => s.adrs.map((a) => a.path)),
    testSelectors: distinct(statements, (s) => s.testSelectors),
    truncated: ranked.length > statements.length,
  };
}

interface SpecRow {
  "Spec.file_path"?: string;
  "Spec.title"?: string;
  stmts?: StmtRow[];
}

/** Lifts the spec's file_path/title onto each of its statement rows for the flat projection. */
function flattenSpecRows(specs: SpecRow[]): StmtRow[] {
  return specs.flatMap((spec) =>
    (spec.stmts ?? []).map((stmt) => ({
      ...stmt,
      spec: {
        "Spec.file_path": spec["Spec.file_path"],
        "Spec.title": spec["Spec.title"],
      },
    })),
  );
}

const GRAPH_CONTEXT_DQL = `query gc($repo: string) {
  q(func: eq(Spec.repo, $repo)) {
    Spec.file_path
    Spec.title
    stmts: ~Statement.spec @filter(has(Statement.validated_by) OR has(Statement.implemented_by) OR has(Statement.decided_by)) {
      uid
      Statement.xid Statement.text Statement.testability Statement.drifted Statement.violated
      section: Statement.section { Section.heading }
      vb: Statement.validated_by { TestChunk.file_path TestChunk.test_name TestChunk.start_line }
      db: Statement.decided_by { ADR.file_path }
    }
  }
}`;

/**
 * Reads a repo's coupled spec Statements from the graph and projects them into a
 * ranked context block. Degrades to an empty block when no graph client is wired,
 * so the caller can fall back to the legacy similarity path without branching.
 */
export async function fetchGraphContext(
  dgraph: DgraphClientPort | null,
  repo: string,
  opts: { limit?: number } = {},
): Promise<GraphContextBlock> {
  if (!dgraph) {
    return { statements: [], adrRefs: [], testSelectors: [], truncated: false };
  }
  const specs = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(GRAPH_CONTEXT_DQL, { $repo: repo });

    return (res.data?.q ?? []) as SpecRow[];
  });

  return assembleGraphContext({ q: flattenSpecRows(specs) }, opts);
}
