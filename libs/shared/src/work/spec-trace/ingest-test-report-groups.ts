/** Aggregates validating TestChunks onto Statements/AcceptanceCriteria — anchor-resolved (spec-anchor comment) and sentence-resolved (structural/name match) groupings, each written with the same violated/violation_reason handling. */

import type {
  DgraphClientPort,
  TestDescriptor,
  TaggedRunResult,
} from "./deps.js";
import { deletePredicate, upsertByXid, withTxn } from "./dgraph-upsert.js";
import { parseSentenceLink, sentenceLinkFromSuite } from "./sentence-link.js";
import {
  resolveSentenceLink,
  type SentenceMatch,
} from "./resolve-sentence-link.js";
import { parseSpecAnchors } from "./spec-anchor.js";
import type { DescriptorChunk } from "./ingest-test-report.js";

/** Accumulated state for one Statement across all descriptors in a report. */
interface StatementGroup {
  xid: string;
  validatingChunkUids: string[];
  failingTestNames: string[];
}

/** Pure data-shaping: folds spec-anchored descriptors into one {@link StatementGroup} per Statement xid, collecting validating TestChunk uids + failing test names. No Dgraph I/O. */
export function groupStatementsByAnchor(
  repo: string,
  entries: DescriptorChunk[],
  resultById: Map<string, TaggedRunResult>,
): StatementGroup[] {
  const groups = new Map<string, StatementGroup>();

  for (const { descriptor, fileChunkUid } of entries) {
    // A descriptor may carry several anchors — contribute its TestChunk to every anchored statement.
    addDescriptorToAnchoredGroups(groups, repo, {
      descriptor,
      fileChunkUid,
      failed: resultById.get(descriptor.id)?.passed === false,
    });
  }

  return [...groups.values()];
}

function addDescriptorToAnchoredGroups(
  groups: Map<string, StatementGroup>,
  repo: string,
  entry: { descriptor: TestDescriptor; fileChunkUid: string; failed: boolean },
): void {
  for (const anchor of parseSpecAnchors(entry.descriptor.spec)) {
    const xid = `${repo}|${anchor.specPath}|${anchor.ordinal}`;
    const group = groups.get(xid) ?? {
      xid,
      validatingChunkUids: [],
      failingTestNames: [],
    };

    group.validatingChunkUids.push(entry.fileChunkUid);

    if (entry.failed) {
      group.failingTestNames.push(entry.descriptor.name);
    }
    groups.set(xid, group);
  }
}

/** Writes one aggregated Statement upsert per group; `violation_reason` is cleared by deleting the predicate on recovery, never by writing `""` (Dgraph corrupts an empty scalar into `"[]"`). */
export async function writeStatementGroup(
  dgraph: DgraphClientPort,
  group: StatementGroup,
): Promise<boolean> {
  const failed = group.failingTestNames.length > 0;
  const statementUid = await upsertByXid(dgraph, "Statement", group.xid, {
    "Statement.validated_by": group.validatingChunkUids.map((uid) => ({ uid })),
    "Statement.violated": failed,
    ...(failed
      ? {
          "Statement.violation_reason": `validating test failed: ${group.failingTestNames.join(", ")}`,
        }
      : {}),
  });

  if (!failed) {
    await deletePredicate(dgraph, statementUid, "Statement.violation_reason");
  }

  return failed;
}

/** A sentence-resolved match node with the validating chunks + failing tests aggregated onto it. */
interface SentenceGroup extends SentenceMatch {
  validatingChunkUids: string[];
  failingTestNames: string[];
}

/** Resolves anchorless descriptors that sentence-match a Statement/AcceptanceCriterion, aggregating validating TestChunks per resolved node. Mirrors {@link groupStatementsByAnchor}, keyed by the resolver's live node uid. */
export async function groupStatementsBySentence(
  dgraph: DgraphClientPort,
  repo: string,
  entries: DescriptorChunk[],
  resultById: Map<string, TaggedRunResult>,
): Promise<SentenceGroup[]> {
  const groups = new Map<string, SentenceGroup>();

  for (const { descriptor, fileChunkUid } of entries) {
    if (parseSpecAnchors(descriptor.spec).length > 0) {
      continue;
    }
    // Structural (describe-nesting) link is primary; falls back to a hand-written name for backward compatibility.
    const link =
      sentenceLinkFromSuite(descriptor) ?? parseSentenceLink(descriptor.name);

    if (!link) {
      continue;
    }

    addDescriptorToSentenceGroups(groups, {
      matches: await resolveSentenceLink(dgraph, repo, link),
      descriptor,
      fileChunkUid,
      failed: resultById.get(descriptor.id)?.passed === false,
    });
  }

  return [...groups.values()];
}

function addDescriptorToSentenceGroups(
  groups: Map<string, SentenceGroup>,
  entry: {
    matches: SentenceMatch[];
    descriptor: TestDescriptor;
    fileChunkUid: string;
    failed: boolean;
  },
): void {
  for (const match of entry.matches) {
    const group = groups.get(match.uid) ?? {
      ...match,
      validatingChunkUids: [],
      failingTestNames: [],
    };

    group.validatingChunkUids.push(entry.fileChunkUid);

    if (entry.failed) {
      group.failingTestNames.push(entry.descriptor.name);
    }
    groups.set(match.uid, group);
  }
}

/** Writes a sentence-resolved group onto its existing node by uid, same violated/violation_reason handling as {@link writeStatementGroup}. */
export async function writeSentenceGroup(
  dgraph: DgraphClientPort,
  group: SentenceGroup,
): Promise<boolean> {
  const failed = group.failingTestNames.length > 0;

  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: {
        uid: group.uid,
        [`${group.nodeType}.validated_by`]: group.validatingChunkUids.map(
          (uid) => ({ uid }),
        ),
        [`${group.nodeType}.violated`]: failed,
        ...(failed
          ? {
              [`${group.nodeType}.violation_reason`]: `validating test failed: ${group.failingTestNames.join(", ")}`,
            }
          : {}),
      },
      commitNow: true,
    }),
  );

  if (!failed) {
    await deletePredicate(
      dgraph,
      group.uid,
      `${group.nodeType}.violation_reason`,
    );
  }

  return failed;
}
