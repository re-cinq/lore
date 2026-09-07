// Turning ONE spec into link suggestions; the repo-wide job lives in spec-coverage-backfill.ts.

import {
  selectCandidates,
  argmaxByTest,
  parseEmbedding,
  type TestChunk,
  type JudgeCandidate,
  type Judgment,
  type MatchKind,
} from "../../domain/spec-judge.js";
import { segmentStatements } from "../../domain/spec-segment.js";
import { type SpecChunkWithEmbedding } from "../../outbound/project/chunks/chunks-port.js";
import { extractAssertions } from "../spec-judge-llm.js";
import { reassembleSpec } from "../spec-summary.js";
import {
  pickStatementsForBackfill,
  proposeLinkInsertions,
  type Suggestion,
} from "./backfill-insertion.js";
import { classifyAllStatements } from "./backfill-classifier.js";
import { judgeLink } from "./backfill-judge.js";
import { buildLabel } from "./backfill-pr.js";

function firstChunkEmbedding(
  chunks: SpecChunkWithEmbedding[],
): SpecChunkWithEmbedding["embedding"] | undefined {
  const first = chunks.at(0);

  return first ? first.embedding : undefined;
}

async function judgeCandidates(
  specPath: string,
  content: string,
  unlinked: Array<{ ordinal: number; text: string }>,
  candidates: JudgeCandidate[],
): Promise<Judgment[]> {
  const judgments: Judgment[] = [];

  for (const candidate of candidates) {
    const verdict = await judgeLink(
      { file_path: specPath, content },
      unlinked,
      candidate,
    );

    judgments.push({
      test_file: candidate.test_file,
      test_name: candidate.test_name,
      test_line: candidate.test_line,
      symbol: candidate.symbol,
      match_kind: candidate.match_kind as MatchKind,
      ...verdict,
    });
  }

  return judgments;
}

function buildSuggestionsFromJudgments(
  confirmed: Judgment[],
  unlinked: Array<{ ordinal: number; text: string }>,
): Suggestion[] {
  const textByOrdinal = new Map(unlinked.map((u) => [u.ordinal, u.text]));

  return confirmed
    .filter(
      (j) =>
        j.statement_ordinal !== null && textByOrdinal.has(j.statement_ordinal),
    )
    .map((j) => ({
      statement_ordinal: j.statement_ordinal as number,
      statement_text: textByOrdinal.get(
        j.statement_ordinal as number,
      ) as string,
      test_file: j.test_file,
      test_line: j.test_line,
      label: buildLabel(j.test_file, j.test_line),
    }));
}

export interface BackfillCandidates {
  content: string;
  unlinked: ReturnType<typeof pickStatementsForBackfill>;
  candidates: ReturnType<typeof selectCandidates>["candidates"];
}

/** The cheap half: reassemble the spec, classify its statements, and narrow to the tests worth asking a model about. Returns null when there is nothing to judge — a spec whose statements are all linked or untestable, or one no candidate test comes close to — so the expensive judgement is never entered for free. */
/** Statements worth suggesting a link for: testable, and not already linked. Classification runs over ALL statements rather than only the unlinked ones — a narrative sentence with no link is not a gap, and treating it as one is how a spec ends up with links on its introduction. */
async function unlinkedTestable(specPath: string, content: string) {
  const statements = segmentStatements(content);

  return pickStatementsForBackfill(
    statements,
    await classifyAllStatements(specPath, statements),
  );
}

/** Tests that might validate this spec. The spec's own assertions are extracted first and matched against the code chunks — vector proximity alone pairs a spec with whatever merely SOUNDS like it, and a link suggested on that basis is noise a reviewer has to refute. */
async function candidateTests(
  spec: {
    repo: string;
    file_path: string;
    content: string;
    embedding: number[] | null;
  },
  codeChunks: TestChunk[],
) {
  const assertions = await extractAssertions(spec.content, spec.file_path, {
    jobName: "spec_coverage_backfill",
  });

  return selectCandidates(spec, assertions, codeChunks).candidates;
}

/** The spec as one document again. It is stored in chunks for search, but classification and link insertion both need the whole thing — a statement's testability often turns on the heading two chunks above it. */
function reassembleChunks(chunks: SpecChunkWithEmbedding[]): string {
  return reassembleSpec(
    chunks.map((c) => ({
      content: c.content,
      ingested_at: c.ingestedAt,
      chunk_index: c.chunkIndex,
    })),
  );
}

export async function findBackfillCandidates(
  repo: string,
  specPath: string,
  chunks: SpecChunkWithEmbedding[],
  codeChunks: TestChunk[],
): Promise<BackfillCandidates | null> {
  const content = reassembleChunks(chunks);
  const unlinked = await unlinkedTestable(specPath, content);

  if (unlinked.length === 0) {
    return null;
  }

  const candidates = await candidateTests(
    {
      repo,
      file_path: specPath,
      content,
      embedding: parseEmbedding(firstChunkEmbedding(chunks)),
    },
    codeChunks,
  );

  if (candidates.length === 0) {
    return null;
  }

  return { content, unlinked, candidates };
}

/** The expensive half: ask a model which candidate validates which statement, keep one test per statement, and rewrite the markdown. Returns null at every point the answer is "nothing to propose", so a spec that yields no insertion never reaches the PR path. */
export async function judgeAndCompose(
  specPath: string,
  content: string,
  found: BackfillCandidates,
): Promise<{
  newContent: string;
  diffPreview: string;
  applied: number;
  confirmed: ReturnType<typeof argmaxByTest>;
} | null> {
  const confirmed = argmaxByTest(
    await judgeCandidates(specPath, content, found.unlinked, found.candidates),
  );

  if (confirmed.length === 0) {
    return null;
  }
  const suggestions = buildSuggestionsFromJudgments(confirmed, found.unlinked);

  if (suggestions.length === 0) {
    return null;
  }
  const { newContent, diffPreview, applied } = proposeLinkInsertions(
    content,
    suggestions,
  );

  return applied === 0 ? null : { newContent, diffPreview, applied, confirmed };
}
