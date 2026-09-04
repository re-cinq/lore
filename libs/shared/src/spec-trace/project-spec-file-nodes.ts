/** Per-facet node projectors for one spec file: Feature/Section/Statement/AcceptanceCriterion/Block upserts, layered on the linked-chunk + orphan-pruning machinery. */

import {
  segmentStatements,
  classifyByHeuristic,
  type Classification,
} from "./deps.js";
import type { DgraphClientPort } from "./deps.js";
import { upsertByXid, replaceEdge, withTxn } from "./dgraph-upsert.js";
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
} from "./project-spec-file.js";

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
  const { dgraph, repo, filePath, specUid } = context;
  const uniqueHeadings = [
    ...new Set(
      segments
        .map((segment) => segment.enclosingHeading)
        .filter((heading): heading is string => heading !== null),
    ),
  ];
  const sectionUidByHeading = new Map<string, string>();

  for (const [sectionOrdinal, heading] of uniqueHeadings.entries()) {
    const sectionUid = await upsertByXid(
      dgraph,
      "Section",
      `${repo}|${filePath}|${sectionOrdinal}`,
      {
        "Section.heading": heading,
        "Section.ordinal": sectionOrdinal,
        "Section.spec": { uid: specUid },
      },
    );

    sectionUidByHeading.set(heading, sectionUid);
  }

  if (sectionUidByHeading.size) {
    await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
      "Spec.sections": [...sectionUidByHeading.values()].map((uid) => ({
        uid,
      })),
    });
  }

  return sectionUidByHeading;
}

/** Upserts one Statement, its inline-link chunks, and its `Statement.section` edge when the segment sits under a heading. */
export async function projectStatement(
  context: ProjectionContext,
  segment: SpecSegment,
  sectionUidByHeading: Map<string, string>,
  classification: Classification,
): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const embedding = await context.embed(segment.text);

  const statementUid = await upsertByXid(
    dgraph,
    "Statement",
    `${repo}|${filePath}|${segment.ordinal}`,
    {
      "Statement.repo": repo,
      "Statement.ordinal": segment.ordinal,
      "Statement.text": segment.text,
      "Statement.text_hash": sha256(segment.text),
      "Statement.spec": { uid: specUid },
      "Statement.kind": segment.kind,
      "Statement.testability": classification.testability,
      ...(classification.category != null
        ? { "Statement.category": classification.category }
        : {}),
      ...(segment.enclosingHeading !== null
        ? {
            "Statement.section": {
              uid: sectionUidByHeading.get(segment.enclosingHeading),
            },
          }
        : {}),
      ...(embedding ? { "Statement.embedding": vectorLiteral(embedding) } : {}),
    },
  );

  await projectLinkEdges(context, statementUid, segment.text, {
    validatedBy: "Statement.validated_by",
    implementedBy: "Statement.implemented_by",
  });

  // DECIDED_BY: links a cited ADR by number, best-effort — specs/adrs project in parallel CI jobs, so an ADR cited in the same push may attach only on a later run.
  const adrRefs = parseAdrRefs(segment.text);

  if (adrRefs.length > 0) {
    const adrUids = await resolveAdrUids(dgraph, repo, adrRefs);

    await replaceEdge(dgraph, statementUid, "Statement.decided_by", adrUids);
  }
}

/** Resolves cited ADR numbers to their node uids for this repo (skips numbers with no ADR node). */
async function resolveAdrUids(
  dgraph: DgraphClientPort,
  repo: string,
  numbers: number[],
): Promise<string[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($repo: string) { adrs(func: eq(ADR.repo, $repo)) { uid ADR.number } }`,
      { $repo: repo },
    );
    const byNumber = new Map<number, string>();

    for (const adr of (res.data?.adrs ?? []) as Array<{
      uid: string;
      "ADR.number"?: number;
    }>) {
      if (adr["ADR.number"] != null) {
        byNumber.set(adr["ADR.number"], adr.uid);
      }
    }

    return numbers
      .map((n) => byNumber.get(n))
      .filter((uid): uid is string => Boolean(uid));
  });
}

/** Upserts one AcceptanceCriterion node plus its inline-link chunks, returning its uid for the forward `Spec.acceptance_criteria` edge. */
async function projectAcceptanceCriterion(
  context: ProjectionContext,
  segment: SpecSegment,
): Promise<string> {
  const { dgraph, repo, filePath, specUid } = context;
  const embedding = await context.embed(segment.text);
  const criterionUid = await upsertByXid(
    dgraph,
    "AcceptanceCriterion",
    `${repo}|${filePath}|ac|${segment.ordinal}`,
    {
      "AcceptanceCriterion.repo": repo,
      "AcceptanceCriterion.ordinal": segment.ordinal,
      "AcceptanceCriterion.text": segment.text,
      "AcceptanceCriterion.text_hash": sha256(segment.text),
      "AcceptanceCriterion.spec": { uid: specUid },
      ...(embedding
        ? { "AcceptanceCriterion.embedding": vectorLiteral(embedding) }
        : {}),
    },
  );

  await projectLinkEdges(context, criterionUid, segment.text, {
    validatedBy: "AcceptanceCriterion.validated_by",
    implementedBy: "AcceptanceCriterion.implemented_by",
  });

  return criterionUid;
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
