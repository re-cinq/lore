/**
 * Validate the test links embedded in each spec.md.
 *
 * v3 of `spec-test-coverage` puts the source of truth for the
 * spec → test linkage in markdown inside the spec itself, as
 * `Statement. ([label](path/to/test.ts#L42))`. This job parses
 * those links from every spec chunk and resolves each link's
 * `path#Lline` against the AST-chunked test metadata in
 * `{schema}.chunks`. Broken links are aggregated per repo and
 * reported via a `spec-link-rot` labelled issue — but only when the
 * repo has no open one already, since this job runs both daily and on
 * every ingest and would otherwise file a fresh duplicate every run.
 *
 * Runs:
 *   1. on every successful `/api/ingest` (post-ingest fan-out via the
 *      `internal.ingest.spec_coverage_validate` event)
 *   2. on a daily sweep schedule, as a fallback in case the post-
 *      ingest trigger missed an event
 *
 * Pure (no DB, no GitHub) helpers exported for unit tests:
 *   - resolveTestLink
 *   - collectBrokenLinks
 *   - formatBrokenLinksReport
 *   - hasOpenLinkRotIssue
 */

import {
  linksForStatements,
  findMisplacedCoverageLinks,
  reassembleSpec,
  resolveLinkPath,
  type TestLinkRef,
  type Project,
  type SpecChunkWithIngest,
} from "../index.js";

export interface ChunkLineRange {
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  /** When the chunk was last ingested/verified. Optional so the pure helpers
   * stay usable without freshness data — absent means "unknown", which keeps
   * the strict pre-freshness judgment. */
  ingested_at?: string | Date | null;
}

export type BrokenLinkReason =
  "file-missing" | "line-out-of-range" | "non-trailing-link";

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
  specIngestedAt?: string | Date | null,
): { ok: true } | { ok: false; reason: BrokenLinkReason } {
  const matching = chunks.filter((c) => c.file_path === link.path);

  if (matching.length === 0) {
    return { ok: false, reason: "file-missing" };
  }

  if (link.line === null) {
    return { ok: true };
  }
  const ranged = matching.filter(
    (c) => c.start_line !== null && c.end_line !== null,
  );

  // A file whose chunks carry no line ranges (pre-v2 chunker output) gives
  // us nothing to judge the line against — unverifiable is not broken.
  if (ranged.length === 0) {
    return { ok: true };
  }
  const covers = ranged.some(
    (c) =>
      (c.start_line as number) <= (link.line as number) &&
      (link.line as number) <= (c.end_line as number),
  );

  if (covers) {
    return { ok: true };
  }

  if (isIndexLagShaped(link.line, ranged, specIngestedAt)) {
    return { ok: true };
  }

  return { ok: false, reason: "line-out-of-range" };
}

/** A line past the file's LAST ranged line, on chunks ingested BEFORE the
 * spec that carries the link, is index lag rather than rot: tests are
 * appended at file end by convention, so a spec linking a just-added test
 * points past the old EOF until reindex re-chunks the file (and the capped
 * sweep can lag by days). Unverifiable-lag is not broken — the daily rerun
 * re-judges once the test chunks catch up to the spec. A stale anchor on a
 * FRESH index (or one landing in a mid-file gap) still flags. */
function isIndexLagShaped(
  line: number,
  ranged: ChunkLineRange[],
  specIngestedAt: string | Date | null | undefined,
): boolean {
  if (specIngestedAt == null) {
    return false;
  }
  const maxEnd = Math.max(...ranged.map((c) => c.end_line as number));

  if (line <= maxEnd) {
    return false;
  }
  const stamps = ranged
    .map((c) => c.ingested_at)
    .filter((t): t is string | Date => t != null)
    .map((t) => new Date(t).getTime());

  if (stamps.length === 0) {
    return false;
  }

  return Math.max(...stamps) < new Date(specIngestedAt).getTime();
}

export function collectBrokenLinks(
  specPath: string,
  content: string,
  chunks: ChunkLineRange[],
  specIngestedAt?: string | Date | null,
): BrokenLink[] {
  const out: BrokenLink[] = [];

  for (const { statement, testLinks } of linksForStatements(content)) {
    for (const link of testLinks) {
      // Chunk file_paths are repo-root-relative; a `../` href is relative to
      // the spec's directory (GitHub-render semantics), so canonicalize before
      // matching — a raw `../` path can never equal a chunk path.
      const resolved: TestLinkRef = {
        ...link,
        path: resolveLinkPath(link.path, specPath),
      };
      const r = resolveTestLink(resolved, chunks, specIngestedAt);

      if (!r.ok) {
        out.push({
          spec_path: specPath,
          statement_text: statement.text,
          link: resolved,
          reason: r.reason,
        });
      }
    }

    for (const link of findMisplacedCoverageLinks(statement.text)) {
      out.push({
        spec_path: specPath,
        statement_text: statement.text,
        link: { ...link, path: resolveLinkPath(link.path, specPath) },
        reason: "non-trailing-link",
      });
    }
  }

  return out;
}

/** GitHub rejects issue bodies over 65,536 chars; leave headroom for the footer. */
const MAX_ISSUE_BODY = 60_000;

export function formatBrokenLinksReport(broken: BrokenLink[]): string {
  if (broken.length === 0) {
    return "";
  }
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
  // Whole bullets only, up to the budget: a raw slice could cut mid-line and
  // drop the footer, and the total counts above already preserve the full
  // picture when the tail is elided.
  let budget = lines.join("\n").length;
  let elided = 0;

  for (const [specPath, list] of bySpec) {
    const heading = `### \`${specPath}\``;

    if (budget + heading.length > MAX_ISSUE_BODY) {
      elided += list.length;
      continue;
    }

    const bullets: string[] = [];
    let sectionBudget = budget + heading.length + 2;

    for (const b of list) {
      const where = `\`${b.link.path}${b.link.line ? `:${b.link.line}` : ""}\``;
      const bullet = `- **${b.reason}** ${where} — referenced by: _${truncate(b.statement_text, 80)}_`;

      if (sectionBudget + bullet.length > MAX_ISSUE_BODY) {
        elided += 1;
        continue;
      }
      bullets.push(bullet);
      sectionBudget += bullet.length + 1;
    }

    // Every bullet was elided — a dangling empty heading would misread as a
    // clean spec, so skip the section entirely.
    if (bullets.length === 0) {
      continue;
    }
    lines.push(heading, "", ...bullets, "");
    budget = sectionBudget + 1;
  }

  if (elided > 0) {
    lines.push(
      `_…and ${elided} more broken link(s) truncated — see the job logs._`,
    );
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "Posted by Lore's `spec-coverage-validate` job. Fix or remove the broken links to silence this.",
  );

  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const LINK_ROT_LABEL = "spec-link-rot";

/** True when the repo already has an open spec-link-rot issue, so we don't file a
 *  duplicate on every daily + per-ingest run. */
export function hasOpenLinkRotIssue(
  openIssues: { labels: string[] }[],
): boolean {
  return openIssues.some((i) => i.labels.includes(LINK_ROT_LABEL));
}

// ── Orchestration (per repo, via the Project facade) ────────────────

export interface ValidateOptions {
  /** The repo whose specs are validated. Set by the detect fan-out and the
   * post-ingest `internal.ingest.spec_coverage_validate` trigger. */
  repoFilter: string;
  /** Data facade — projectFor(repo) on the Floor, createStationProject(env) in
   *  a pod. Defaults to projectFor(repo). */
  project: Project;
}

/** Group a repo's spec chunks by file path so multi-chunk specs reassemble. */
function specsByPath(
  specs: SpecChunkWithIngest[],
): Map<string, SpecChunkWithIngest[]> {
  const byPath = new Map<string, SpecChunkWithIngest[]>();

  for (const s of specs) {
    const list = byPath.get(s.filePath) ?? [];

    list.push(s);
    byPath.set(s.filePath, list);
  }

  return byPath;
}

/** Newest ingest stamp across a spec's chunks — the freshness of the links it
 * carries, compared against test-chunk stamps to spot index lag. */
function latestIngest(chunks: SpecChunkWithIngest[]): string | Date | null {
  const stamps = chunks
    .map((c) => c.ingestedAt)
    .filter((t): t is string | Date => t != null);

  if (stamps.length === 0) {
    return null;
  }

  return stamps.reduce((a, b) =>
    new Date(a).getTime() >= new Date(b).getTime() ? a : b,
  );
}

export async function validateSpecCoverageJob(
  opts: ValidateOptions,
): Promise<string> {
  const repo = opts.repoFilter;
  const project = opts.project;

  const specs = await project.chunks.specChunksWithIngest();

  if (specs.length === 0) {
    console.log(`[job] spec-coverage-validate: no specs for ${repo}`);

    return "No specs found";
  }

  const testChunks: ChunkLineRange[] = (
    await project.chunks.testChunkRanges()
  ).map((c) => ({
    file_path: c.filePath,
    start_line: c.startLine,
    end_line: c.endLine,
    ingested_at: c.ingestedAt,
  }));

  const broken: BrokenLink[] = [];
  let totalSpecs = 0;

  for (const [specPath, chunks] of specsByPath(specs)) {
    totalSpecs++;
    const content = reassembleSpec(
      chunks.map((c) => ({
        content: c.content,
        ingested_at: c.ingestedAt,
        chunk_index: c.chunkIndex,
      })),
    );

    broken.push(
      ...collectBrokenLinks(
        specPath,
        content,
        testChunks,
        latestIngest(chunks),
      ),
    );
  }

  let reportsOpened = 0;

  if (broken.length > 0) {
    // Dedup: skip filing when an open spec-link-rot issue already exists (this
    // job runs daily AND on every ingest). A read failure leaves openIssues empty
    // and we fall through to file — surfacing the rot beats silence.
    try {
      const openIssues = await project.issues
        .list({ state: "open" })
        .catch((err) => {
          console.error(
            `[job] spec-coverage-validate: open-issue read failed for ${repo}:`,
            err,
          );

          return [] as Awaited<ReturnType<typeof project.issues.list>>;
        });

      if (hasOpenLinkRotIssue(openIssues)) {
        console.log(
          `[job] spec-coverage-validate: ${repo} — ${broken.length} broken links, open spec-link-rot issue exists, skipping`,
        );
      } else {
        const issue = await project.issues.create(
          "Broken test links in spec.md",
          formatBrokenLinksReport(broken),
          [LINK_ROT_LABEL, "lore-managed"],
        );

        reportsOpened++;
        console.log(
          `[job] spec-coverage-validate: ${repo} — ${broken.length} broken links → issue ${issue.url}`,
        );
      }
    } catch (err) {
      console.error(
        `[job] spec-coverage-validate: failed to file report for ${repo}:`,
        err,
      );
    }
  }

  const summary = `Checked ${totalSpecs} specs in ${repo} — ${broken.length} broken links, ${reportsOpened} reports opened`;

  console.log(`[job] spec-coverage-validate: ${summary}`);

  return summary;
}
