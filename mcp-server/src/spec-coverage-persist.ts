/**
 * Server-side persist handler for the BYO-compute spec→test linker.
 *
 * The client (a developer's local Claude session) sends classifications
 * for the statements the section heuristic couldn't decide, plus
 * judgments mapping each candidate test to a single best-validated
 * statement with a confidence score. This module enforces the trust
 * boundary: the developer can't write malformed rows even if they're
 * sloppy or hostile.
 *
 * Validations (all server-side, no client cooperation needed):
 *   - 404 → no spec chunks at the path
 *   - 409 → supplied content_hash doesn't match the current hash
 *     (the spec drifted mid-conversation; client should re-prepare)
 *   - 400 invalid_ordinal → classification or judgment references an
 *     ordinal that isn't in the current segmenter output
 *   - 400 invalid_score → judgment score is outside [τ, 1]
 *
 * After validation, argmaxByTest dedupe runs server-side so a client
 * sending two judgments for the same (test_file, test_name) keeps only
 * the higher-scoring row. spec_statements + spec_test_links + the
 * coverage_runs attribution row are written under the same prune-on-
 * rerun semantics as the agent-side cron.
 */

import type { Pool } from "pg";
import {
  reassembleSpec,
  segmentStatements,
  buildIntroOrdinals,
  classifyByHeuristic,
  argmaxByTest,
  hashSpecContent,
  staleStatementOrdinals,
  staleLinkKeys,
  JUDGE_SCORE_THRESHOLD,
  type Statement,
  type Classification,
  type Judgment,
  type UntestableCategory,
  type MatchKind,
} from "@re-cinq/lore-shared";
import { resolvePrepareSchema } from "./spec-coverage-prepare.js";
import { composeSpecCoverage, type SpecCoverageEntry } from "./routes.js";

export interface PersistClassification {
  ordinal: number;
  testability: "testable" | "untestable";
  category?: UntestableCategory;
}

export interface PersistJudgment {
  test_file: string;
  test_name: string;
  statement_ordinal: number;
  score: number;
  rationale: string;
}

export interface PersistRequest {
  spec_path: string;
  content_hash: string;
  classifications: PersistClassification[];
  judgments: PersistJudgment[];
  agent_id?: string;
}

export type PersistResponse =
  | { status: 200; body: SpecCoverageEntry }
  | { status: 400; body: { error: string; ordinal?: number; score?: number; detail?: string } }
  | { status: 404; body: { error: string; spec_path: string } }
  | { status: 409; body: { error: "content_hash_stale"; current_hash: string } }
  | { status: 503; body: { error: string } };

interface SpecChunkRow {
  content: string;
  ingested_at: string | Date;
  embedding: unknown;
}

export async function persistSpecCoverage(
  pool: Pool,
  repo: string,
  specPath: string,
  body: PersistRequest,
): Promise<PersistResponse> {
  const schema = await resolvePrepareSchema(pool, repo);

  const { rows: specChunks } = await pool.query<SpecChunkRow>(
    `SELECT content, ingested_at, embedding
     FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1 AND file_path = $2
     ORDER BY ingested_at`,
    [repo, specPath],
  );
  if (specChunks.length === 0) {
    return { status: 404, body: { error: "no spec chunks at this path", spec_path: specPath } };
  }

  const content = reassembleSpec(specChunks);
  const currentHash = hashSpecContent(content);
  if (currentHash !== body.content_hash) {
    return { status: 409, body: { error: "content_hash_stale", current_hash: currentHash } };
  }

  // Re-segment server-side so the validity check uses authoritative ordinals.
  const statements = segmentStatements(content);
  const introOrdinals = buildIntroOrdinals(statements);
  const heuristicByOrdinal = new Map<number, Classification>();
  for (const s of statements) {
    heuristicByOrdinal.set(s.ordinal, classifyByHeuristic(s, introOrdinals));
  }
  const validOrdinals = new Set(statements.map((s) => s.ordinal));
  const statementByOrdinal = new Map(statements.map((s) => [s.ordinal, s]));

  // Validate classifications.
  for (const c of body.classifications) {
    if (!validOrdinals.has(c.ordinal)) {
      return {
        status: 400,
        body: { error: "invalid_ordinal", ordinal: c.ordinal, detail: "Not in the current statement set." },
      };
    }
  }

  // Merge classifications with heuristic. Client overrides win over heuristic
  // for any statement that wasn't matched by section (i.e. the heuristic
  // returned testable by default and the client decided otherwise).
  const finalClassifications = new Map<number, Classification>(heuristicByOrdinal);
  for (const c of body.classifications) {
    const existing = heuristicByOrdinal.get(c.ordinal)!;
    if (existing.matchedBySection) continue; // section heuristic wins on locked categories
    finalClassifications.set(c.ordinal, {
      testability: c.testability,
      category: c.testability === "untestable" ? (c.category ?? null) : null,
      matchedBySection: false,
    });
  }

  const testableOrdinals = new Set(
    [...finalClassifications.entries()]
      .filter(([, c]) => c.testability === "testable")
      .map(([ord]) => ord),
  );

  // Validate judgments: ordinal must be testable, score in [τ, 1].
  for (const j of body.judgments) {
    if (!testableOrdinals.has(j.statement_ordinal)) {
      return {
        status: 400,
        body: {
          error: "invalid_ordinal",
          ordinal: j.statement_ordinal,
          detail: "Not in the testable statement subset.",
        },
      };
    }
    if (j.score < JUDGE_SCORE_THRESHOLD || j.score > 1) {
      return {
        status: 400,
        body: {
          error: "invalid_score",
          score: j.score,
          detail: `Must be in [${JUDGE_SCORE_THRESHOLD}, 1].`,
        },
      };
    }
  }

  // Convert judgments to the shared Judgment shape so argmaxByTest dedupes.
  const judgmentRows: Judgment[] = body.judgments.map((j) => ({
    test_file: j.test_file,
    test_name: j.test_name,
    test_line: null, // server has no AST line lookup at persist time; client may add later
    symbol: null,
    match_kind: "assertion" as MatchKind, // best available default for client-judged rows
    matches: true,
    statement_ordinal: j.statement_ordinal,
    statement_text: statementByOrdinal.get(j.statement_ordinal)?.text ?? null,
    match_score: j.score,
    rationale: j.rationale,
  }));
  const dedupedLinks = argmaxByTest(judgmentRows);

  const linkedBy = `local:${body.agent_id ?? "unknown"}`;

  await persistStatements(pool, schema, repo, specPath, statements, finalClassifications);
  await persistLinks(pool, schema, repo, specPath, dedupedLinks);
  await recordCoverageRun(pool, schema, repo, specPath, currentHash, linkedBy);

  // Refetch the full coverage payload for the response (so the UI can
  // render immediately without a follow-up GET).
  const refetched = await refetchCoverageEntry(pool, schema, repo, specPath);
  return { status: 200, body: refetched };
}

async function persistStatements(
  pool: Pool,
  schema: string,
  repo: string,
  specPath: string,
  statements: Statement[],
  classifications: Map<number, Classification>,
): Promise<void> {
  for (const s of statements) {
    const c = classifications.get(s.ordinal)!;
    await pool.query(
      `INSERT INTO ${schema}.spec_statements
         (repo, spec_path, ordinal, text, kind, testability, category, classified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (repo, spec_path, ordinal)
       DO UPDATE SET
         text          = EXCLUDED.text,
         kind          = EXCLUDED.kind,
         testability   = EXCLUDED.testability,
         category      = EXCLUDED.category,
         classified_at = now()`,
      [repo, specPath, s.ordinal, s.text, s.kind, c.testability, c.category],
    );
  }
  const { rows: existing } = await pool.query<{ ordinal: number }>(
    `SELECT ordinal FROM ${schema}.spec_statements WHERE repo = $1 AND spec_path = $2`,
    [repo, specPath],
  );
  const stale = staleStatementOrdinals(
    existing.map((r) => r.ordinal),
    statements.map((s) => s.ordinal),
  );
  for (const ord of stale) {
    await pool.query(
      `DELETE FROM ${schema}.spec_statements WHERE repo = $1 AND spec_path = $2 AND ordinal = $3`,
      [repo, specPath, ord],
    );
  }
}

async function persistLinks(
  pool: Pool,
  schema: string,
  repo: string,
  specPath: string,
  confirmed: Judgment[],
): Promise<void> {
  for (const link of confirmed) {
    await pool.query(
      `INSERT INTO ${schema}.spec_test_links
         (repo, spec_path, test_file, test_name, test_line, symbol, match_kind,
          rationale, statement_ordinal, statement_text, match_score, linked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (repo, spec_path, test_file, test_name)
       DO UPDATE SET
         test_line         = EXCLUDED.test_line,
         symbol            = EXCLUDED.symbol,
         match_kind        = EXCLUDED.match_kind,
         rationale         = EXCLUDED.rationale,
         statement_ordinal = EXCLUDED.statement_ordinal,
         statement_text    = EXCLUDED.statement_text,
         match_score       = EXCLUDED.match_score,
         linked_at         = now()`,
      [
        repo,
        specPath,
        link.test_file,
        link.test_name,
        link.test_line,
        link.symbol,
        link.match_kind,
        link.rationale,
        link.statement_ordinal,
        link.statement_text,
        link.match_score,
      ],
    );
  }
  const { rows: existing } = await pool.query<{ test_file: string; test_name: string }>(
    `SELECT test_file, test_name FROM ${schema}.spec_test_links WHERE repo = $1 AND spec_path = $2`,
    [repo, specPath],
  );
  const stale = staleLinkKeys(existing, confirmed);
  for (const link of stale) {
    await pool.query(
      `DELETE FROM ${schema}.spec_test_links
       WHERE repo = $1 AND spec_path = $2 AND test_file = $3 AND test_name = $4`,
      [repo, specPath, link.test_file, link.test_name],
    );
  }
}

async function recordCoverageRun(
  pool: Pool,
  schema: string,
  repo: string,
  specPath: string,
  contentHash: string,
  linkedBy: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO ${schema}.spec_coverage_runs (repo, spec_path, content_hash, run_at, linked_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (repo, spec_path)
     DO UPDATE SET content_hash = EXCLUDED.content_hash,
                   run_at       = now(),
                   linked_by    = EXCLUDED.linked_by`,
    [repo, specPath, contentHash, linkedBy],
  );
}

async function refetchCoverageEntry(
  pool: Pool,
  schema: string,
  repo: string,
  specPath: string,
): Promise<SpecCoverageEntry> {
  const { rows: chunkRows } = await pool.query<{
    file_path: string;
    content: string;
    ingested_at: string | Date;
  }>(
    `SELECT file_path, content, ingested_at FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1 AND file_path = $2`,
    [repo, specPath],
  );
  const { rows: statementRows } = await pool.query<{
    spec_path: string;
    ordinal: number;
    text: string;
    kind: string;
    testability: string;
    category: string | null;
  }>(
    `SELECT $2::text AS spec_path, ordinal, text, kind, testability, category
     FROM ${schema}.spec_statements
     WHERE repo = $1 AND spec_path = $2
     ORDER BY ordinal`,
    [repo, specPath],
  );
  const { rows: linkRows } = await pool.query<{
    spec_path: string;
    test_file: string;
    test_name: string;
    test_line: number | null;
    symbol: string | null;
    match_kind: string;
    rationale: string;
    statement_ordinal: number | null;
    statement_text: string | null;
    match_score: number | null;
  }>(
    `SELECT $2::text AS spec_path, test_file, test_name, test_line, symbol,
            match_kind, rationale, statement_ordinal, statement_text, match_score
     FROM ${schema}.spec_test_links
     WHERE repo = $1 AND spec_path = $2`,
    [repo, specPath],
  );
  return composeSpecCoverage(repo, specPath, chunkRows, statementRows, linkRows);
}
