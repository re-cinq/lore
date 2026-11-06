/** Phase 1 projection unit: projects one spec file into the Dgraph traceability graph (Repo/Spec/Section/Statement/TestChunk/CodeChunk/AcceptanceCriterion/Block), gated by a `Spec.content_hash` freshness check. */

import type { SourceDocument } from "./project-blocks.js";
import {
  segmentStatements,
  buildIntroOrdinals,
  getQueryEmbeddings,
} from "../../outbound/spec-trace/deps.js";
import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  withTxn,
  upsertByXid,
  deletePredicate,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import { pruneOrphans } from "./project-spec-file-links.js";
import {
  projectFeature,
  projectSections,
  projectAcceptanceCriteria,
  projectBlocks,
  projectStatements,
  type SpecSegment,
} from "./project-spec-file-nodes.js";
import {
  criteriaToWrite,
  NO_STORED_CHILDREN,
  readStoredChildren,
  statementsToWrite,
  type ChildPlan,
  type StoredChildren,
} from "./unchanged-children.js";
import {
  sha256,
  type EmbedFn,
  type ProjectionContext,
} from "./project-spec-file-context.js";

export {
  type EmbedFn,
  vectorLiteral,
  type ProjectionContext,
  sha256,
} from "./project-spec-file-context.js";
import { firstOf } from "./uid-refs.js";

/** Knobs on one projection: the embedder to use and whether to bypass the content-hash freshness gate. */
export interface ProjectionOptions {
  embed?: EmbedFn;
  force?: boolean;
  /** Reads a linked file at the ingested commit; see {@link ProjectionContext.readLinked}. */
  readLinked?: (path: string) => Promise<string | null>;
}

export async function projectSpecFile(
  document: SourceDocument,
  dgraph: DgraphClientPort,
  options: ProjectionOptions = {},
): Promise<{ projected: boolean }> {
  const { repo, filePath, content } = document;
  const contentHash = sha256(content);
  const specXid = `${repo}|${filePath}`;

  if (!options.force && (await isSpecUnchanged(dgraph, specXid, contentHash))) {
    return { projected: false };
  }
  const target = specTarget(dgraph, document, options);

  await projectSpecChildren(await target, content, storedReadFor(options));
  await upsertByXid(dgraph, "Spec", specXid, {
    "Spec.content_hash": contentHash,
  });

  return { projected: true };
}

/** The Spec node itself, then where its children are written, with the embedder and the linked-file reader the options name. */
async function specTarget(
  dgraph: DgraphClientPort,
  document: SourceDocument,
  { embed = getQueryEmbeddings, readLinked }: ProjectionOptions,
): Promise<SpecTarget> {
  return {
    dgraph,
    repo: document.repo,
    filePath: document.filePath,
    specUid: await projectSpecNode(dgraph, document),
    embed,
    readLinked: readLinked && readOnce(readLinked),
  };
}

/** A reader that fetches each path once per projection: many statements cite the same test file. */
function readOnce(
  read: (path: string) => Promise<string | null>,
): (path: string) => Promise<string | null> {
  const reads = new Map<string, Promise<string | null>>();

  return (path) => {
    if (!reads.has(path)) {
      reads.set(path, read(path));
    }

    return reads.get(path) ?? read(path);
  };
}

/** True when the persisted Spec.content_hash already matches, so re-projection can be skipped. */
async function isSpecUnchanged(
  dgraph: DgraphClientPort,
  specXid: string,
  contentHash: string,
): Promise<boolean> {
  return (await readSpecContentHash(dgraph, specXid)) === contentHash;
}

/** Reads the persisted Spec.content_hash for an xid, or undefined when no Spec exists yet. */
async function readSpecContentHash(
  dgraph: DgraphClientPort,
  specXid: string,
): Promise<string | undefined> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query find($xid: string) { found(func: eq(Spec.xid, $xid), first: 1) { Spec.content_hash } }`,
      { $xid: specXid },
    );

    return firstOf(res.data.found)?.["Spec.content_hash"] as string | undefined;
  });
}

/** The Spec node itself, hung off its feature and its repo, with the content hash CLEARED. The hash is written back only after every child write succeeds — a projection that dies mid-file must look unprojected next run, or the file stays permanently skipped with half its statements missing. */
async function projectSpecNode(
  dgraph: DgraphClientPort,
  { repo, filePath, content }: SourceDocument,
): Promise<string> {
  const specUid = await upsertSpecNode(dgraph, repo, filePath, {
    title: extractTitle(content),
    featureUid: await projectFeature(dgraph, repo, filePath),
  });

  await deletePredicate(dgraph, specUid, "Spec.content_hash");
  await upsertByXid(dgraph, "Repo", repo, { "Repo.specs": [{ uid: specUid }] });

  return specUid;
}

/** The spec's first H1 heading text (the title a sentence-link's `<spec>` segment matches), or null. */
function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+?)\s*$/m);

  return match ? match[1] : null;
}

/** The Spec node's optional own fields — title and feature link, both absent for a bare/root-level spec. */
interface SpecOwnFields {
  title: string | null;
  featureUid: string | undefined;
}

/** Upserts the Spec node's own scalar/edge fields (title and feature link are optional). */
async function upsertSpecNode(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
  { title, featureUid }: SpecOwnFields,
): Promise<string> {
  return upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
    "Spec.repo": repo,
    "Spec.file_path": filePath,
    ...(title !== null ? { "Spec.title": title } : {}),
    ...(featureUid ? { "Spec.feature": { uid: featureUid } } : {}),
  });
}

/** Everything that hangs off a spec: its sections, the statements and acceptance criteria this run changes, and its code blocks — each followed by a prune over every segment, so a skipped child counts as produced and one deleted from the markdown does not linger in the graph as a validated claim. */
async function projectSpecChildren(
  target: SpecTarget,
  content: string,
  readStored: StoredChildrenRead,
): Promise<void> {
  const { plan, split } = await childPlan(target, content, readStored);
  const written = await childrenToWrite(plan, split);
  const context = await embeddedContext(target, [
    ...written.statementSegments,
    ...written.acSegments,
  ]);

  await projectStatementLayer(context, plan, written, split.statementSegments);
  await projectAcceptanceCriteriaLayer(context, written.acSegments, split);
  await projectBlocks(context, content, plan.stored.blocks);
}

/** How a projection learns what the graph holds for a spec's children. */
type StoredChildrenRead = (target: SpecTarget) => Promise<StoredChildren>;

/** A forced projection writes every child; an ordinary one only those that changed. */
function storedReadFor({ force }: ProjectionOptions): StoredChildrenRead {
  return force ? nothingStored : storedInGraph;
}

/** A forced projection treats the graph as holding nothing, so it writes every child. */
const nothingStored: StoredChildrenRead = () =>
  Promise.resolve(NO_STORED_CHILDREN);

/** An ordinary projection reads what the spec's children hold, so it writes only the ones that changed (re-cinq/lore#4150). */
const storedInGraph: StoredChildrenRead = ({ dgraph, repo, filePath }) =>
  readStoredChildren(dgraph, `${repo}|${filePath}`);

/** The spec's segments and, since a statement's comparison needs their uids, its sections written first, with what the graph holds for its children. */
async function childPlan(
  target: SpecTarget,
  content: string,
  readStored: StoredChildrenRead,
): Promise<{ plan: ChildPlan; split: SplitSegments }> {
  const segments = segmentStatements(content);
  const split = splitAcceptanceCriteria(segments);
  const sectionUidByHeading = await projectSections(
    target,
    split.statementSegments,
  );
  const plan = {
    context: target,
    stored: await readStored(target),
    introOrdinals: buildIntroOrdinals(segments),
    sectionUidByHeading,
  };

  return { plan, split };
}

/** The statement and criterion segments whose nodes, links or edges would change. */
async function childrenToWrite(
  plan: ChildPlan,
  { statementSegments, acSegments }: SplitSegments,
): Promise<SplitSegments> {
  return {
    statementSegments: await statementsToWrite(plan, statementSegments),
    acSegments: await criteriaToWrite(plan, acSegments),
  };
}

/** Where a spec's children are written, plus the embedder that has not run yet. */
type SpecTarget = Omit<ProjectionContext, "embeddingOf"> & { embed: EmbedFn };

/** Embeds the written segments' texts in one call, so each node reads its vector instead of asking for it; a skipped segment needs none. */
async function embeddedContext(
  { embed, ...address }: SpecTarget,
  segments: SpecSegment[],
): Promise<ProjectionContext> {
  const texts = segments.map((segment) => segment.text);
  const vectors = await embed(texts);
  const vectorByText = new Map(
    texts.map((text, index) => [text, vectors[index]]),
  );

  return { ...address, embeddingOf: (text) => vectorByText.get(text) ?? null };
}

/** A spec's segments, split into statements and acceptance criteria. */
type SplitSegments = Record<"statementSegments" | "acSegments", SpecSegment[]>;

/** Acceptance-criteria segments project as AcceptanceCriterion nodes, everything else as Statements. */
function splitAcceptanceCriteria(segments: SpecSegment[]): SplitSegments {
  return {
    statementSegments: segments.filter(
      (segment) => !isAcceptanceCriteriaHeading(segment.enclosingHeading),
    ),
    acSegments: segments.filter((segment) =>
      isAcceptanceCriteriaHeading(segment.enclosingHeading),
    ),
  };
}

/** True for any heading-variant title used across specs for acceptance/success/independent-test criteria — those segments project as AcceptanceCriterion, not Statement. */
export function isAcceptanceCriteriaHeading(heading: string | null): boolean {
  if (!heading) {
    return false;
  }
  const norm = heading
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[:\s]+$/g, "")
    .trim();

  return (
    /acceptance criteria/.test(norm) ||
    norm === "success criteria" ||
    norm === "independent test criteria"
  );
}

/** The statements this run writes, then the orphans no segment claims, skipped ones included. */
async function projectStatementLayer(
  context: ProjectionContext,
  { introOrdinals, sectionUidByHeading }: ChildPlan,
  { statementSegments }: SplitSegments,
  allStatements: SpecSegment[],
): Promise<void> {
  await projectStatements(
    context,
    statementSegments,
    introOrdinals,
    sectionUidByHeading,
  );
  await pruneStatementOrphans(
    context,
    allStatements.map((segment) => segment.ordinal),
  );
  await pruneSectionOrphans(context, sectionUidByHeading.size);
}

/** Removes statements this projection did not produce. The prune matches by XID and runs AFTER the upserts, so a statement that only moved ordinal is re-anchored rather than deleted — deleting it would take the test links pointing at it with it. */
async function pruneStatementOrphans(
  context: ProjectionContext,
  statementOrdinals: number[],
): Promise<void> {
  const { repo, filePath } = context;
  const validXids = statementOrdinals.map(
    (ordinal) => `${repo}|${filePath}|${ordinal}`,
  );

  await pruneOrphans(context, "Statement", new Set(validXids));
}

/** Removes the sections above `sectionCount` — the ones left behind when a re-projection produced fewer headings than the run before it. */
async function pruneSectionOrphans(
  context: ProjectionContext,
  sectionCount: number,
): Promise<void> {
  const { repo, filePath } = context;
  const validXids = Array.from(
    { length: sectionCount },
    (_, ordinal) => `${repo}|${filePath}|${ordinal}`,
  );

  await pruneOrphans(context, "Section", new Set(validXids), "Spec.sections");
}

/** The acceptance criteria this run writes, followed by the prune of the ones no segment claims. */
async function projectAcceptanceCriteriaLayer(
  context: ProjectionContext,
  written: SpecSegment[],
  { acSegments }: SplitSegments,
): Promise<void> {
  const { repo, filePath } = context;

  await projectAcceptanceCriteria(context, written);

  const validAcXids = new Set(
    acSegments.map((segment) => `${repo}|${filePath}|ac|${segment.ordinal}`),
  );

  await pruneOrphans(
    context,
    "AcceptanceCriterion",
    validAcXids,
    "Spec.acceptance_criteria",
  );
}
