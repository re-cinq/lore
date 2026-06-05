/**
 * Coverage-report parsers for the bulk `POST /api/repos/:o/:r/coverage`
 * body. `parseLcov` turns LCOV text into the format-agnostic
 * {@link CoveredChunk} shape shared with `tests.run` and `test-report`.
 * The line-number → contiguous-range collapse is format-independent and
 * lives in `collapseIntoRanges` so a sibling Cobertura parser can reuse it.
 * See `specs/project-test-interface/contracts/test-commands.md`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { CoveredChunk } from "@re-cinq/lore-shared";
import { json, readJsonBody, requireCommit } from "./http.js";

interface CoverageGroup {
  test: string;
  covered: CoveredChunk[];
}

interface CoverageBody {
  commit?: string;
  coverage?: CoverageGroup[];
  format?: string;
  payload?: string;
}

interface CoverageCounts {
  coverage_nodes: number;
  covers_edges: number;
  files_covered: number;
}

export async function handleCoverageRoute(
  req: IncomingMessage,
  res: ServerResponse,
  _pool: Pool | null,
): Promise<void> {
  // Graph persistence is a deferred seam (no Dgraph projection layer yet),
  // so `_pool` is intentionally untouched.
  const body = (await readJsonBody(req)) as CoverageBody;

  if (!requireCommit(body, res)) return;

  if (body.format && body.format !== "lcov" && body.format !== "cobertura") {
    json(res, 400, { error: `unsupported format: ${body.format}` });
    return;
  }

  json(res, 200, countCoverage(normalizeByFormat(body)));
}

/**
 * Resolve any supported body shape to the canonical list of coverage
 * groups. The canonical `coverage[]` body passes through; a
 * `format`-tagged raw payload is normalized into a single synthetic group.
 * New formats (e.g. cobertura) add one branch here, not in the handler.
 */
function normalizeByFormat(body: CoverageBody): CoverageGroup[] {
  if (body.coverage) return body.coverage;
  if (body.format === "lcov" && typeof body.payload === "string") {
    return parseLcovGroups(body.payload);
  }
  if (body.format === "cobertura" && typeof body.payload === "string") {
    return groupByFile(parseCobertura(body.payload));
  }
  return [];
}

/**
 * One coverage group per covered file. A format-tagged payload has no
 * per-test grouping, so each file becomes its own node — matching the
 * canonical body's one-node-per-group counting.
 */
function groupByFile(chunks: CoveredChunk[]): CoverageGroup[] {
  const byFile = new Map<string, CoveredChunk[]>();
  for (const chunk of chunks) {
    const covered = byFile.get(chunk.file) ?? [];
    covered.push(chunk);
    byFile.set(chunk.file, covered);
  }
  return [...byFile].map(([file, covered]) => ({ test: file, covered }));
}

/** Count graph nodes (groups), edges (covered chunks), and distinct files. */
function countCoverage(groups: CoverageGroup[]): CoverageCounts {
  const chunks = groups.flatMap((group) => group.covered);
  const files = new Set(chunks.map((chunk) => chunk.file));
  return {
    coverage_nodes: groups.length,
    covers_edges: chunks.length,
    files_covered: files.size,
  };
}

/**
 * One parsed LCOV record: the source file, its test name (`TN:`, falling
 * back to the file when absent), and the covered lines collapsed into
 * ranges. The sole authority on how to read an LCOV record — both
 * `parseLcov` and `parseLcovGroups` build on it so the split / SF / TN /
 * DA-filter knowledge lives in exactly one place.
 */
function lcovRecords(lcov: string): CoverageGroup[] {
  const records: CoverageGroup[] = [];

  for (const record of lcov.split(/^end_of_record$/m)) {
    const file = record.match(/^SF:(.+)$/m)?.[1];
    if (!file) continue;
    const test = record.match(/^TN:(.+)$/m)?.[1] ?? file;

    const coveredLines = [...record.matchAll(/^DA:(\d+),(\d+)$/gm)]
      .filter((match) => Number(match[2]) > 0)
      .map((match) => Number(match[1]));

    records.push({ test, covered: collapseIntoRanges(file, coveredLines) });
  }

  return records;
}

export function parseLcov(lcov: string): CoveredChunk[] {
  return lcovRecords(lcov).flatMap((record) => record.covered);
}

export function parseLcovGroups(lcov: string): CoverageGroup[] {
  const byTest = new Map<string, CoveredChunk[]>();

  for (const { test, covered } of lcovRecords(lcov)) {
    const merged = byTest.get(test) ?? [];
    merged.push(...covered);
    byTest.set(test, merged);
  }

  return [...byTest].map(([test, covered]) => ({ test, covered }));
}

export function parseCobertura(xml: string): CoveredChunk[] {
  const chunks: CoveredChunk[] = [];

  for (const block of xml.matchAll(/<class[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
    const file = block[1];

    const coveredLines = [...block[2].matchAll(/<line\s+number="(\d+)"\s+hits="(\d+)"/g)]
      .filter((match) => Number(match[2]) > 0)
      .map((match) => Number(match[1]));

    chunks.push(...collapseIntoRanges(file, coveredLines));
  }

  return chunks;
}

export function collapseIntoRanges(file: string, lines: number[]): CoveredChunk[] {
  const sorted = [...lines].sort((first, second) => first - second);
  const ranges: CoveredChunk[] = [];

  let current: CoveredChunk | null = null;
  for (const line of sorted) {
    if (current && line === current.endLine + 1) {
      current.endLine = line;
      continue;
    }
    current = { file, startLine: line, endLine: line };
    ranges.push(current);
  }

  return ranges;
}
