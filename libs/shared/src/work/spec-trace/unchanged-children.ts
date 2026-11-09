/** Which of a spec's statements and acceptance criteria a re-projection writes: one the graph already holds as this run would write it is skipped, so a one-line edit writes one statement rather than the whole spec (re-cinq/lore#4150). */

import {
  classifyByHeuristic,
  type DgraphClientPort,
} from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import { parseAdrRefs } from "./adr-refs.js";
import { plannedLinks, type PlannedLinks } from "./project-spec-file-links.js";
import {
  readAdrUidsByNumber,
  type SpecSegment,
} from "./project-spec-file-nodes.js";
import { sha256, type ProjectionContext } from "./project-spec-file-context.js";
import type { StoredBlock } from "./project-blocks.js";
import { edgeRows } from "./uid-refs.js";

/** What projecting a statement or criterion writes, as far as deciding to skip it needs; criteria carry no kind, classification, section or ADRs. */
export interface ChildState {
  textHash?: string;
  kind?: string;
  testability?: string;
  category?: string;
  sectionUid?: string;
  validated: string[];
  implemented: string[];
  decided?: string[];
}

/** What this run would write for one child, and whether its hashed links still sit where its text says. */
export type PlannedChild = ChildState & Pick<PlannedLinks, "linksInSync">;

/** The spec's stored statements, criteria and blocks, keyed by xid. */
export interface StoredChildren {
  statements: ReadonlyMap<string, ChildState>;
  criteria: ReadonlyMap<string, ChildState>;
  blocks: ReadonlyMap<string, StoredBlock>;
}

/** Everything deciding which children to write reads besides the segments themselves. */
export interface ChildPlan {
  context: Pick<
    ProjectionContext,
    "dgraph" | "repo" | "filePath" | "readLinked"
  >;
  stored: StoredChildren;
  introOrdinals: Set<number>;
  sectionUidByHeading: Map<string, string>;
}

/** Projection always writes these; a stored value that differs means the child changed. */
const ALWAYS_WRITTEN = ["textHash", "kind", "testability"] as const;
/** Projection writes these only when it has one and never clears them, so a stale stored value is no change. */
const WRITTEN_WHEN_PRESENT = ["category", "sectionUid"] as const;

/** True when the graph already holds this child as this run would write it, so writing it again changes nothing. */
export function isUnchanged(
  stored: ChildState | undefined,
  planned: PlannedChild,
): boolean {
  if (stored === undefined || !planned.linksInSync) {
    return false;
  }

  return sameFields(stored, planned) && sameEdges(stored, planned);
}

function sameFields(stored: ChildState, planned: ChildState): boolean {
  return (
    ALWAYS_WRITTEN.every((key) => stored[key] === planned[key]) &&
    WRITTEN_WHEN_PRESENT.every(
      (key) => planned[key] === undefined || stored[key] === planned[key],
    )
  );
}

// A statement that cites no ADR never has its decided_by edge rewritten, so only a cited one compares it.
function sameEdges(stored: ChildState, planned: ChildState): boolean {
  return (
    sameSet(stored.validated, planned.validated) &&
    sameSet(stored.implemented, planned.implemented) &&
    (planned.decided === undefined ||
      sameSet(stored.decided ?? [], planned.decided))
  );
}

function sameSet(left: string[], right: string[]): boolean {
  const ours = new Set(left);
  const theirs = new Set(right);

  return ours.size === theirs.size && [...ours].every((xid) => theirs.has(xid));
}

/** The statement segments whose node, links or ADR edge would change. */
export async function statementsToWrite(
  plan: ChildPlan,
  segments: SpecSegment[],
): Promise<SpecSegment[]> {
  const adrUidByNumber = await citedAdrUids(plan, segments);
  const { context, stored } = plan;
  const { repo, filePath } = context;
  const unchanged = await Promise.all(
    segments.map(async (segment) =>
      isUnchanged(
        stored.statements.get(`${repo}|${filePath}|${segment.ordinal}`),
        await plannedStatement(plan, segment, adrUidByNumber),
      ),
    ),
  );

  return segments.filter((segment, index) => !unchanged[index]);
}

/** The acceptance-criterion segments whose node or links would change. */
export async function criteriaToWrite(
  plan: ChildPlan,
  segments: SpecSegment[],
): Promise<SpecSegment[]> {
  const { context, stored } = plan;
  const { repo, filePath } = context;
  const unchanged = await Promise.all(
    segments.map(async (segment) =>
      isUnchanged(
        stored.criteria.get(`${repo}|${filePath}|ac|${segment.ordinal}`),
        {
          textHash: sha256(segment.text),
          ...(await plannedLinks(plan.context, segment.text)),
        },
      ),
    ),
  );

  return segments.filter((segment, index) => !unchanged[index]);
}

/** What projectStatement would write for one segment. */
async function plannedStatement(
  plan: ChildPlan,
  segment: SpecSegment,
  adrUidByNumber: ReadonlyMap<number, string>,
): Promise<PlannedChild> {
  return {
    textHash: sha256(segment.text),
    kind: segment.kind,
    ...placedFields(plan, segment),
    ...decidedBy(segment.text, adrUidByNumber),
    ...(await plannedLinks(plan.context, segment.text)),
  };
}

/** The classification and section a statement would carry; category and section only when it has one, as projectStatement writes them. */
function placedFields(
  { introOrdinals, sectionUidByHeading }: ChildPlan,
  segment: SpecSegment,
): Partial<ChildState> {
  const { testability, category } = classifyByHeuristic(segment, introOrdinals);
  const sectionUid = sectionUidByHeading.get(segment.enclosingHeading ?? "");

  return {
    testability,
    ...(category != null ? { category } : {}),
    ...(sectionUid !== undefined ? { sectionUid } : {}),
  };
}

/** The ADR uids a statement's decided_by edge would hold, only when it cites one. */
function decidedBy(
  text: string,
  adrUidByNumber: ReadonlyMap<number, string>,
): Pick<ChildState, "decided"> {
  const numbers = parseAdrRefs(text);

  if (numbers.length === 0) {
    return {};
  }

  return {
    decided: numbers.flatMap((number) => adrUidByNumber.get(number) ?? []),
  };
}

/** The repo's ADRs by number, read once and only when a statement cites one. */
async function citedAdrUids(
  { context }: ChildPlan,
  segments: SpecSegment[],
): Promise<ReadonlyMap<number, string>> {
  const cites = segments.some((segment) => parseAdrRefs(segment.text).length);

  return cites ? readAdrUidsByNumber(context.dgraph, context.repo) : new Map();
}

/** No stored children: a forced projection, or a spec never projected, writes every one. */
export const NO_STORED_CHILDREN: StoredChildren = {
  statements: new Map(),
  criteria: new Map(),
  blocks: new Map(),
};

const STORED_CHILDREN_QUERY = `query q($xid: string) {
  spec(func: eq(Spec.xid, $xid)) {
    statements: ~Statement.spec {
      xid: Statement.xid
      textHash: Statement.text_hash
      kind: Statement.kind
      testability: Statement.testability
      category: Statement.category
      section: Statement.section { uid }
      validated: Statement.validated_by { xid: TestChunk.xid }
      implemented: Statement.implemented_by { xid: CodeChunk.xid }
      decided: Statement.decided_by { uid }
    }
    criteria: ~AcceptanceCriterion.spec {
      xid: AcceptanceCriterion.xid
      textHash: AcceptanceCriterion.text_hash
      validated: AcceptanceCriterion.validated_by { xid: TestChunk.xid }
      implemented: AcceptanceCriterion.implemented_by { xid: CodeChunk.xid }
    }
    blocks: ~Block.spec {
      xid: Block.xid
      kind: Block.kind
      text: Block.text
      level: Block.level
    }
  }
}`;

/** One read of everything the spec's statements and criteria hold, keyed by xid. */
export async function readStoredChildren(
  dgraph: DgraphClientPort,
  specXid: string,
): Promise<StoredChildren> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(STORED_CHILDREN_QUERY, {
      $xid: specXid,
    });

    const { spec } = res.data;

    return storedChildrenOf(spec?.[0]);
  });
}

/** The query's spec row as two maps of stored state by xid. */
export function storedChildrenOf(
  spec: Record<string, unknown> | undefined,
): StoredChildren {
  return {
    statements: byXid(spec?.["statements"], stateOf),
    criteria: byXid(spec?.["criteria"], stateOf),
    blocks: byXid(spec?.["blocks"], blockOf),
  };
}

function byXid<T>(
  rows: unknown,
  parse: (row: Record<string, unknown>) => T,
): ReadonlyMap<string, T> {
  const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];

  return new Map(
    list.flatMap((row) =>
      typeof row["xid"] === "string" ? [[row["xid"], parse(row)]] : [],
    ),
  );
}

function blockOf(row: Record<string, unknown>): StoredBlock {
  return {
    ...(typeof row["kind"] === "string" ? { kind: row["kind"] } : {}),
    ...(typeof row["text"] === "string" ? { text: row["text"] } : {}),
    ...(typeof row["level"] === "number" ? { level: row["level"] } : {}),
  };
}

function stateOf(row: Record<string, unknown>): ChildState {
  return {
    ...textFields(row),
    ...uidField("sectionUid", firstUid(row["section"])),
    validated: xidsOf(row["validated"]),
    implemented: xidsOf(row["implemented"]),
    decided: uidsOf(row["decided"]),
  };
}

function textFields(row: Record<string, unknown>): Partial<ChildState> {
  return Object.fromEntries(
    (["textHash", "kind", "testability", "category"] as const).flatMap((key) =>
      typeof row[key] === "string" ? [[key, row[key]]] : [],
    ),
  );
}

function uidField(
  key: "sectionUid",
  uid: string | undefined,
): Partial<ChildState> {
  return uid === undefined ? {} : { [key]: uid };
}

function firstUid(value: unknown): string | undefined {
  return uidsOf(value).at(0);
}

function uidsOf(value: unknown): string[] {
  return stringsOf(value, "uid");
}

function xidsOf(value: unknown): string[] {
  return stringsOf(value, "xid");
}

function stringsOf(value: unknown, key: string): string[] {
  return edgeRows(value).flatMap((row) =>
    typeof row[key] === "string" ? [row[key]] : [],
  );
}
