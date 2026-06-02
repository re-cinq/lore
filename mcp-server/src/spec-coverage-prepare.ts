/**
 * Pure prepare-side composer for the BYO-compute spec→test linker.
 *
 * Returns the payload the developer's local Claude session reads from
 * the `prepare_spec_link` MCP tool: spec content, deterministic
 * statements with section-heuristic classifications, candidate tests
 * pre-filtered by assertion / directory / embedding signals, and a
 * content hash that the matching `persist_spec_link` call must echo.
 *
 * No LLM calls here — those happen client-side in the developer's
 * Claude conversation. All deterministic.
 */

import type { Pool } from "pg";
import {
  reassembleSpec,
  segmentStatements,
  buildIntroOrdinals,
  classifyByHeuristic,
  selectCandidates,
  deriveTestName,
  parseEmbedding,
  isTestFile,
  hashSpecContent,
  type Classification,
  type Assertion,
  type TestChunk,
} from "@re-cinq/lore-shared";

interface SpecChunkRow {
  content: string;
  ingested_at: string | Date;
  embedding: unknown;
}

interface CodeRow {
  file_path: string;
  content: string;
  metadata: Record<string, unknown> | null;
  embedding: unknown;
}

export interface PrepareStatement {
  ordinal: number;
  text: string;
  kind: string;
  enclosing_heading: string | null;
  heuristic: {
    testability: string;
    category: string | null;
    matched_by_section: boolean;
  };
}

export interface CoverageHit {
  covered_file: string;
  covered_symbol: string | null;
  lines_covered: number[];
}

export interface PrepareCandidate {
  test_file: string;
  test_name: string;
  test_line: number | null;
  content_snippet: string;
  match_kind: string;
  symbol: string | null;
  coverage_hits: CoverageHit[];
}

export interface PrepareResponse {
  spec_path: string;
  content: string;
  content_hash: string;
  statements: PrepareStatement[];
  candidate_tests: PrepareCandidate[];
  candidate_truncated: boolean;
  assertion_hints: string[] | null;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;
const SNIPPET_CHARS = 1500;

export async function resolvePrepareSchema(pool: Pool, repo: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT team FROM lore.repos WHERE full_name = $1`,
    [repo],
  );
  const team = rows[0]?.team;
  if (team && SCHEMA_RE.test(team)) {
    const { rows: schemas } = await pool.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [team],
    );
    if (schemas.length > 0) return team;
  }
  return "org_shared";
}

/**
 * Builds the prepare payload. Returns `null` when no spec chunks exist
 * for `specPath` so the route handler can 404.
 *
 * `assertionsForRepo` is an optional pre-extracted assertion list (the
 * cron's `extractAssertions` output, cached). When absent, the
 * candidate pre-filter falls back to directory + embedding only —
 * `assertion_hints` in the response is `null` so the client knows the
 * judge should infer named symbols on its own.
 */
export async function prepareSpecCoverage(
  pool: Pool,
  repo: string,
  specPath: string,
  assertionsForRepo?: Assertion[],
): Promise<PrepareResponse | null> {
  const schema = await resolvePrepareSchema(pool, repo);

  const { rows: specChunks } = await pool.query<SpecChunkRow>(
    `SELECT content, ingested_at, embedding
     FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1 AND file_path = $2
     ORDER BY ingested_at`,
    [repo, specPath],
  );
  if (specChunks.length === 0) return null;

  const content = reassembleSpec(specChunks);
  const content_hash = hashSpecContent(content);
  const statements = segmentStatements(content);
  const introOrdinals = buildIntroOrdinals(statements);
  const classifications = new Map<number, Classification>();
  for (const s of statements) {
    classifications.set(s.ordinal, classifyByHeuristic(s, introOrdinals));
  }

  const { rows: codeRows } = await pool.query<CodeRow>(
    `SELECT file_path, content, metadata, embedding
     FROM ${schema}.chunks
     WHERE repo = $1 AND content_type = 'code'`,
    [repo],
  );
  const testChunks: TestChunk[] = codeRows
    .filter((row) => isTestFile(row.file_path))
    .map((row) => ({
      file_path: row.file_path,
      content: row.content,
      test_name: deriveTestName(row.metadata) ?? "",
      test_line: toLine(row.metadata),
      embedding: parseEmbedding(row.embedding),
    }))
    .filter((chunk) => chunk.test_name.length > 0);

  const specEmbedding = parseEmbedding(specChunks[0]?.embedding);
  const assertions = assertionsForRepo ?? [];
  const { candidates, truncated } = selectCandidates(
    { repo, file_path: specPath, content, embedding: specEmbedding },
    assertions,
    testChunks,
  );

  const coverageByCandidate = await loadCoverageHits(pool, schema, repo, candidates);

  return {
    spec_path: specPath,
    content,
    content_hash,
    statements: statements.map((s) => {
      const c = classifications.get(s.ordinal)!;
      return {
        ordinal: s.ordinal,
        text: s.text,
        kind: s.kind,
        enclosing_heading: s.enclosingHeading,
        heuristic: {
          testability: c.testability,
          category: c.category,
          matched_by_section: c.matchedBySection,
        },
      };
    }),
    candidate_tests: candidates.map((c) => ({
      test_file: c.test_file,
      test_name: c.test_name,
      test_line: c.test_line,
      content_snippet: c.content.slice(0, SNIPPET_CHARS),
      match_kind: c.match_kind,
      symbol: c.symbol,
      coverage_hits: coverageByCandidate.get(`${c.test_file} ${c.test_name}`) ?? [],
    })),
    candidate_truncated: truncated,
    assertion_hints: assertionsForRepo?.map((a) => a.name) ?? null,
  };
}

/**
 * Coverage stub. Returns an empty map until the future
 * `specs/coverage-ingestion` spec delivers the `coverage_lines` table.
 * The 42P01 ("relation does not exist") catch lets this ship today and
 * start populating real data the moment that table appears, with no
 * client change required.
 */
async function loadCoverageHits(
  pool: Pool,
  schema: string,
  repo: string,
  candidates: { test_file: string; test_name: string }[],
): Promise<Map<string, CoverageHit[]>> {
  const map = new Map<string, CoverageHit[]>();
  if (candidates.length === 0) return map;
  try {
    const params: unknown[] = [repo];
    const tuples = candidates
      .map((c, i) => {
        params.push(c.test_file, c.test_name);
        return `($${2 + i * 2}, $${3 + i * 2})`;
      })
      .join(", ");
    const { rows } = await pool.query<{
      test_file: string;
      test_name: string;
      covered_file: string;
      covered_symbol: string | null;
      line_start: number;
      line_end: number;
    }>(
      `SELECT test_file, test_name, covered_file, NULL::text AS covered_symbol,
              line_start, line_end
       FROM ${schema}.coverage_lines
       WHERE repo = $1
         AND (test_file, test_name) IN (${tuples})`,
      params,
    );
    for (const row of rows) {
      const key = `${row.test_file} ${row.test_name}`;
      const list = map.get(key) ?? [];
      const existing = list.find(
        (h) => h.covered_file === row.covered_file && h.covered_symbol === row.covered_symbol,
      );
      const lineRange: number[] = [];
      for (let l = row.line_start; l <= row.line_end; l++) lineRange.push(l);
      if (existing) {
        existing.lines_covered.push(...lineRange);
      } else {
        list.push({
          covered_file: row.covered_file,
          covered_symbol: row.covered_symbol,
          lines_covered: lineRange,
        });
      }
      map.set(key, list);
    }
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
    // Coverage table doesn't exist yet — graceful degrade to no hits.
  }
  return map;
}

function toLine(metadata: Record<string, unknown> | null): number | null {
  const raw = metadata?.["start_line"];
  const line = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(line) ? line : null;
}
