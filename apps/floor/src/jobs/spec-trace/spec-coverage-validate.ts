/**
 * Validate the test links embedded in each spec.md.
 *
 * v3 of `spec-test-coverage` puts the source of truth for the
 * spec → test linkage in markdown inside the spec itself, as
 * `Statement. ([label](path/to/test.ts#L42))`. This job parses
 * those links from every spec chunk and resolves each link's
 * `path#Lline` against the AST-chunked test metadata in
 * `{schema}.chunks`. Broken links are aggregated per repo and
 * reported via PR comment (when there's an open spec PR) or via
 * a `spec-link-rot` labelled issue (fallback).
 *
 * Runs:
 *   1. on every successful `/api/ingest` (post-ingest fan-out via
 *      `POST /api/trigger/spec-coverage-validate`, replacing the v2
 *      `/api/trigger/spec-test-linker`)
 *   2. on a daily sweep schedule, as a fallback in case the post-
 *      ingest trigger missed an event
 *
 * Pure (no DB, no GitHub) helpers exported for unit tests:
 *   - resolveTestLink
 *   - collectBrokenLinks
 *   - formatBrokenLinksReport
 */

import {
  linksForStatements,
  findMisplacedCoverageLinks,
  reassembleSpec,
  type TestLinkRef,
} from "@re-cinq/lore-shared";
import { query } from "../../kernel/db.js";
import { projectFor } from "../../composition/project-boot.js";

export interface ChunkLineRange {
  file_path: string;
  start_line: number | null;
  end_line: number | null;
}

export type BrokenLinkReason =
  | "file-missing"
  | "line-out-of-range"
  | "non-trailing-link";

export interface BrokenLink {
  spec_path: string;
  statement_text: string;
  link: TestLinkRef;
  reason: BrokenLinkReason;
}

// ── Pure helpers ────────────────────────────────────────────────────

export function resolveTestLink(
  link: TestLinkRef,
  chunks: ChunkLineRange[],
): { ok: true } | { ok: false; reason: BrokenLinkReason } {
  const matching = chunks.filter((c) => c.file_path === link.path);
  if (matching.length === 0) return { ok: false, reason: "file-missing" };
  if (link.line === null) return { ok: true };
  const covers = matching.some(
    (c) =>
      c.start_line !== null &&
      c.end_line !== null &&
      c.start_line <= (link.line as number) &&
      (link.line as number) <= c.end_line,
  );
  return covers ? { ok: true } : { ok: false, reason: "line-out-of-range" };
}

export function collectBrokenLinks(
  specPath: string,
  content: string,
  chunks: ChunkLineRange[],
): BrokenLink[] {
  const out: BrokenLink[] = [];
  for (const { statement, testLinks } of linksForStatements(content)) {
    for (const link of testLinks) {
      const r = resolveTestLink(link, chunks);
      if (!r.ok) {
        out.push({ spec_path: specPath, statement_text: statement.text, link, reason: r.reason });
      }
    }
    for (const link of findMisplacedCoverageLinks(statement.text)) {
      out.push({
        spec_path: specPath,
        statement_text: statement.text,
        link,
        reason: "non-trailing-link",
      });
    }
  }
  return out;
}

export function formatBrokenLinksReport(broken: BrokenLink[]): string {
  if (broken.length === 0) return "";
  const bySpec = new Map<string, BrokenLink[]>();
  for (const b of broken) {
    const list = bySpec.get(b.spec_path) ?? [];
    list.push(b);
    bySpec.set(b.spec_path, list);
  }
  const lines: string[] = [
    "**Broken or misplaced test links detected**",
    "",
    `${broken.length} link${broken.length === 1 ? "" : "s"} across ${bySpec.size} spec${bySpec.size === 1 ? "" : "s"} don't resolve to a known test chunk or sit outside the trailing parenthetical.`,
    "",
  ];
  for (const [specPath, list] of bySpec) {
    lines.push(`### \`${specPath}\``);
    lines.push("");
    for (const b of list) {
      const where = `\`${b.link.path}${b.link.line ? `:${b.link.line}` : ""}\``;
      lines.push(`- **${b.reason}** ${where} — referenced by: _${truncate(b.statement_text, 80)}_`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("Posted by Lore's `spec-coverage-validate` job. Fix or remove the broken links to silence this.");
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── Orchestration ──────────────────────────────────────────────────

interface SpecChunkRow {
  repo: string;
  file_path: string;
  content: string;
  ingested_at: string | Date;
}

interface CodeChunkRow {
  file_path: string;
  start_line: number | null;
  end_line: number | null;
}

interface SchemaRow { schema: string }

async function getSchemasWithSpecs(): Promise<string[]> {
  // Same pg_catalog discovery the v2 linker used — any schema with a chunks table.
  const rows = await query<SchemaRow>(
    `SELECT n.nspname AS schema
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'chunks' AND c.relkind = 'r'
     ORDER BY n.nspname`,
  );
  return rows.map((r) => r.schema);
}

async function loadTestChunks(schema: string, repo: string): Promise<ChunkLineRange[]> {
  const rows = await query<{
    file_path: string;
    start_line: number | null;
    end_line: number | null;
  }>(
    `SELECT file_path,
            (metadata->>'start_line')::int AS start_line,
            (metadata->>'end_line')::int   AS end_line
     FROM ${schema}.chunks
     WHERE repo = $1 AND content_type = 'code'`,
    [repo],
  );
  return rows;
}

export interface ValidateOptions {
  /** When set, only specs in this repo are validated. The post-ingest
   * webhook trigger sets this to the just-ingested repo. */
  repoFilter?: string;
}

export async function validateSpecCoverageJob(opts: ValidateOptions = {}): Promise<string> {
  const schemas = await getSchemasWithSpecs();
  if (schemas.length === 0) {
    console.log("[job] spec-coverage-validate: no chunks tables found");
    return "No chunks tables found";
  }

  let totalRepos = 0;
  let totalSpecs = 0;
  let totalBroken = 0;
  let reportsOpened = 0;

  for (const schema of schemas) {
    const specs = opts.repoFilter
      ? await query<SpecChunkRow>(
          `SELECT repo, file_path, content, ingested_at
           FROM ${schema}.chunks
           WHERE content_type = 'spec' AND repo = $1
           ORDER BY repo, file_path, ingested_at`,
          [opts.repoFilter],
        )
      : await query<SpecChunkRow>(
          `SELECT repo, file_path, content, ingested_at
           FROM ${schema}.chunks
           WHERE content_type = 'spec'
           ORDER BY repo, file_path, ingested_at`,
        );
    if (specs.length === 0) continue;

    // Group spec chunks by (repo, file_path) so we can reassemble multi-chunk specs.
    const byRepoPath = new Map<string, Map<string, SpecChunkRow[]>>();
    for (const s of specs) {
      const byPath = byRepoPath.get(s.repo) ?? new Map<string, SpecChunkRow[]>();
      const list = byPath.get(s.file_path) ?? [];
      list.push(s);
      byPath.set(s.file_path, list);
      byRepoPath.set(s.repo, byPath);
    }

    for (const [repo, byPath] of byRepoPath) {
      totalRepos++;
      const codeChunks = await loadTestChunks(schema, repo);
      const brokenForRepo: BrokenLink[] = [];

      for (const [specPath, chunks] of byPath) {
        totalSpecs++;
        const content = reassembleSpec(chunks);
        const broken = collectBrokenLinks(specPath, content, codeChunks);
        brokenForRepo.push(...broken);
      }

      if (brokenForRepo.length === 0) continue;
      totalBroken += brokenForRepo.length;

      const body = formatBrokenLinksReport(brokenForRepo);
      try {
        const project = await projectFor(repo);
        const issue = await project.issues.create(
          "Broken test links in spec.md",
          body,
          ["spec-link-rot", "lore-managed"],
        );
        reportsOpened++;
        console.log(
          `[job] spec-coverage-validate: ${repo} — ${brokenForRepo.length} broken links → issue ${issue.url}`,
        );
      } catch (err) {
        console.error(`[job] spec-coverage-validate: failed to file report for ${repo}:`, err);
      }
    }
  }

  const summary = `Checked ${totalSpecs} specs across ${totalRepos} repos — ${totalBroken} broken links, ${reportsOpened} reports opened`;
  console.log(`[job] spec-coverage-validate: ${summary}`);
  return summary;
}
