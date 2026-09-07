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
export async function findBackfillCandidates(
  repo: string,
  specPath: string,
  chunks: SpecChunkWithEmbedding[],
  codeChunks: TestChunk[],
): Promise<BackfillCandidates | null> {
  const content = reassembleSpec(
    chunks.map((c) => ({
      content: c.content,
      ingested_at: c.ingestedAt,
      chunk_index: c.chunkIndex,
    })),
  );
  const statements = segmentStatements(content);
  const classifications = await classifyAllStatements(specPath, statements);

  const unlinked = pickStatementsForBackfill(statements, classifications);

  if (unlinked.length === 0) {
    return null;
  }

  const assertions = await extractAssertions(content, specPath, {
    jobName: "spec_coverage_backfill",
  });
  const specEmbedding = parseEmbedding(firstChunkEmbedding(chunks));
  const { candidates } = selectCandidates(
    { repo, file_path: specPath, content, embedding: specEmbedding },
    assertions,
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
