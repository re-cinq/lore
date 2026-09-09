/** Per-facet node projectors for one spec file: Feature/Section/Statement/AcceptanceCriterion/Block upserts, layered on the linked-chunk + orphan-pruning machinery. */

import {
  segmentStatements,
  classifyByHeuristic,
  type Classification,
} from "../../outbound/spec-trace/deps.js";
import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  upsertByXid,
  replaceEdge,
  withTxn,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import { parseAdrRefs } from "./adr-refs.js";
import {
  projectDocumentBlocks,
  pruneOrphanBlocksByFile,
} from "./project-blocks.js";
import { featureDirOf } from "./feature-dir.js";
import { projectLinkEdges } from "./project-spec-file-links.js";
import {
  sha256,
  vectorLiteral,
  type ProjectionContext,
} from "./project-spec-file-context.js";

/** Upserts the Feature node for this spec's owning folder, returning its uid for `Spec.feature` (undefined for a root-level spec with no feature folder). */
export async function projectFeature(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<string | undefined> {
  const featureDir = featureDirOf(filePath);

  if (featureDir === null) {
    return undefined;
  }

  return upsertByXid(dgraph, "Feature", `${repo}|${featureDir}`, {
    "Feature.repo": repo,
    "Feature.path": featureDir,
    "Feature.title": featureDir.split("/").pop() ?? featureDir,
  });
}

/** One segment as produced by {@link segmentStatements}. */
export type SpecSegment = ReturnType<typeof segmentStatements>[number];

/** Upserts a Section per unique enclosing heading in document order, points `Spec.sections` at them, and returns heading→uid so statements can attach. */
export async function projectSections(
  context: ProjectionContext,
  segments: SpecSegment[],
): Promise<Map<string, string>> {
  const { dgraph, repo, filePath } = context;
  const sectionUids = new Map<string, string>();

  for (const [ordinal, heading] of uniqueHeadings(segments).entries()) {
    sectionUids.set(heading, await upsertSection(context, heading, ordinal));
  }

  if (sectionUids.size) {
    await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
      "Spec.sections": [...sectionUids.values()].map((uid) => ({ uid })),
    });
  }

  return sectionUids;
}

/** The document's headings in order, deduplicated. Segments with no enclosing heading are dropped rather than grouped under a synthetic one: a statement in a document's preamble belongs to no section, and inventing one would put it under a heading a reader cannot find. */
function uniqueHeadings(segments: SpecSegment[]): string[] {
  return [
    ...new Set(
      segments
        .map((segment) => segment.enclosingHeading)
        .filter((heading): heading is string => heading !== null),
    ),
  ];
}

/** Upserts one Section at `ordinal` — the heading's POSITION in the document, which the xid is built from, so a heading that moves gets a different xid and is re-anchored by the prune that follows. */
async function upsertSection(
  { dgraph, repo, filePath, specUid }: ProjectionContext,
  heading: string,
  ordinal: number,
): Promise<string> {
  return upsertByXid(dgraph, "Section", `${repo}|${filePath}|${ordinal}`, {
    "Section.heading": heading,
    "Section.ordinal": ordinal,
    "Section.spec": { uid: specUid },
  });
}

/** Upserts an AcceptanceCriterion per "Acceptance Criteria" segment and points `Spec.acceptance_criteria` at them; specs without any leave the edge untouched. */
export async function projectAcceptanceCriteria(
  context: ProjectionContext,
  acSegments: SpecSegment[],
): Promise<void> {
  const { dgraph, repo, filePath } = context;
  const criterionUids: string[] = [];

  for (const segment of acSegments) {
    criterionUids.push(await projectAcceptanceCriterion(context, segment));
  }

  if (criterionUids.length) {
    await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
      "Spec.acceptance_criteria": criterionUids.map((uid) => ({ uid })),
    });
  }
}

/** Upserts one AcceptanceCriterion node plus its inline-link chunks, returning its uid for the forward `Spec.acceptance_criteria` edge. */
async function projectAcceptanceCriterion(
  context: ProjectionContext,
  segment: SpecSegment,
): Promise<string> {
  const { dgraph, repo, filePath } = context;
  const embedding = await context.embed(segment.text);
  const criterionUid = await upsertByXid(
    dgraph,
    "AcceptanceCriterion",
    `${repo}|${filePath}|ac|${segment.ordinal}`,
    criterionFacts(context, segment, embedding),
  );

  await projectLinkEdges(context, criterionUid, segment.text, {
    validatedBy: "AcceptanceCriterion.validated_by",
    implementedBy: "AcceptanceCriterion.implemented_by",
  });

  return criterionUid;
}

/** The AcceptanceCriterion node's own predicates; the embedding is omitted when the embedder produced none. */
function criterionFacts(
  { repo, specUid }: ProjectionContext,
  segment: SpecSegment,
  embedding: number[] | null | undefined,
): Record<string, unknown> {
  return {
    "AcceptanceCriterion.repo": repo,
    "AcceptanceCriterion.ordinal": segment.ordinal,
    "AcceptanceCriterion.text": segment.text,
    "AcceptanceCriterion.text_hash": sha256(segment.text),
    "AcceptanceCriterion.spec": { uid: specUid },
    ...(embedding
      ? { "AcceptanceCriterion.embedding": vectorLiteral(embedding) }
      : {}),
  };
}

/** Projects the lossless Block source layer via the shared writer, then prunes orphaned Blocks through the file-scoped sweep shared with the ADR path. */
export async function projectBlocks(
  context: ProjectionContext,
  content: string,
): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const validBlockXids = await projectDocumentBlocks(
    dgraph,
    { repo, filePath, content },
    specUid,
  );

  await pruneOrphanBlocksByFile(dgraph, repo, filePath, validBlockXids);
}

/** Upserts every statement segment's Statement node in turn. */
export async function projectStatements(
  context: ProjectionContext,
  statementSegments: SpecSegment[],
  introOrdinals: Set<number>,
  sectionUidByHeading: Map<string, string>,
): Promise<void> {
  for (const segment of statementSegments) {
    const classification = classifyByHeuristic(segment, introOrdinals);

    await projectStatement(
      context,
      segment,
      sectionUidByHeading,
      classification,
    );
  }
}

/** Upserts one Statement, its inline-link chunks, and its `Statement.section` edge when the segment sits under a heading. */
export async function projectStatement(
  context: ProjectionContext,
  segment: SpecSegment,
  sectionUidByHeading: Map<string, string>,
  classification: Classification,
): Promise<void> {
  const embedding = await context.embed(segment.text);
  const statementUid = await upsertStatement(context, segment, {
    classification,
    sectionUid: sectionUidByHeading.get(segment.enclosingHeading ?? ""),
    embedding,
  });

  await projectLinkEdges(context, statementUid, segment.text, {
    validatedBy: "Statement.validated_by",
    implementedBy: "Statement.implemented_by",
  });
  await projectDecidedBy(context, statementUid, segment.text);
}

/** The classification, section and embedding a statement's projection resolved before writing the node. */
interface StatementExtras {
  classification: Classification;
  sectionUid: string | undefined;
  embedding: number[] | null | undefined;
}

/** Upserts the Statement node itself, returning its uid. */
async function upsertStatement(
  context: ProjectionContext,
  segment: SpecSegment,
  extras: StatementExtras,
): Promise<string> {
  const { dgraph, repo, filePath } = context;

  return upsertByXid(
    dgraph,
    "Statement",
    `${repo}|${filePath}|${segment.ordinal}`,
    statementFacts(context, segment, extras),
  );
}

/** The Statement node's own predicates. */
function statementFacts(
  { repo, specUid }: ProjectionContext,
  segment: SpecSegment,
  extras: StatementExtras,
): Record<string, unknown> {
  const { classification } = extras;

  return {
    "Statement.repo": repo,
    "Statement.ordinal": segment.ordinal,
    "Statement.text": segment.text,
    "Statement.text_hash": sha256(segment.text),
    "Statement.spec": { uid: specUid },
    "Statement.kind": segment.kind,
    "Statement.testability": classification.testability,
    ...optionalStatementFacts(extras),
  };
}

/** The Statement's optional predicates. They are omitted rather than nulled: a stored null reads back the same as a deliberate value, so writing one would make an unclassified statement look deliberately uncategorized. */
function optionalStatementFacts({
  classification,
  sectionUid,
  embedding,
}: StatementExtras): Record<string, unknown> {
  return {
    ...(classification.category != null
      ? { "Statement.category": classification.category }
      : {}),
    ...(sectionUid !== undefined
      ? { "Statement.section": { uid: sectionUid } }
      : {}),
    ...(embedding ? { "Statement.embedding": vectorLiteral(embedding) } : {}),
  };
}

/** DECIDED_BY: links a cited ADR by number, best-effort — specs/adrs project in parallel CI jobs, so an ADR cited in the same push may attach only on a later run. */
async function projectDecidedBy(
  { dgraph, repo }: ProjectionContext,
  statementUid: string,
  text: string,
): Promise<void> {
  const adrRefs = parseAdrRefs(text);

  if (adrRefs.length === 0) {
    return;
  }
  const adrUids = await resolveAdrUids(dgraph, repo, adrRefs);

  await replaceEdge(dgraph, statementUid, "Statement.decided_by", adrUids);
}

/** Resolves cited ADR numbers to their node uids for this repo (skips numbers with no ADR node). */
async function resolveAdrUids(
  dgraph: DgraphClientPort,
  repo: string,
  numbers: number[],
): Promise<string[]> {
  const uidByNumber = await readAdrUidsByNumber(dgraph, repo);

  return numbers
    .map((number) => uidByNumber.get(number))
    .filter((uid): uid is string => Boolean(uid));
}

/** Reads every ADR node of this repo together with its ADR number. */
const ADR_NUMBERS_QUERY = `query q($repo: string) { adrs(func: eq(ADR.repo, $repo)) { uid ADR.number } }`;

/** Every ADR node of this repo, keyed by its ADR number. */
async function readAdrUidsByNumber(
  dgraph: DgraphClientPort,
  repo: string,
): Promise<Map<number, string>> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(ADR_NUMBERS_QUERY, { $repo: repo });
    const adrs = (res.data.adrs ?? []) as Array<{
      uid: string;
      "ADR.number"?: number;
    }>;
    const byNumber = new Map<number, string>();

    for (const adr of adrs) {
      if (adr["ADR.number"] != null) {
        byNumber.set(adr["ADR.number"], adr.uid);
      }
    }

    return byNumber;
  });
}
