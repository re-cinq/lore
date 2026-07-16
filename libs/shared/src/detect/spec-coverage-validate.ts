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
  type TestLinkRef,
  type Project,
  type SpecChunkWithIngest,
} from "../index.js";

export interface ChunkLineRange {
  file_path: string;
  start_line: number | null;
  end_line: number | null;
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
): { ok: true } | { ok: false; reason: BrokenLinkReason } {
  const matching = chunks.filter((c) => c.file_path === link.path);

  if (matching.length === 0) {
    return { ok: false, reason: "file-missing" };
  }

  if (link.line === null) {
    return { ok: true };
  }
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
        out.push({
          spec_path: specPath,
          statement_text: statement.text,
          link,
          reason: r.reason,
        });
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

  for (const [specPath, list] of bySpec) {
    lines.push(`### \`${specPath}\``);
    lines.push("");

    for (const b of list) {
      const where = `\`${b.link.path}${b.link.line ? `:${b.link.line}` : ""}\``;

      lines.push(
        `- **${b.reason}** ${where} — referenced by: _${truncate(b.statement_text, 80)}_`,
      );
    }
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
export function specsByPath(
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
  }));

  const broken: BrokenLink[] = [];
  let totalSpecs = 0;

  for (const [specPath, chunks] of specsByPath(specs)) {
    totalSpecs++;
    const content = reassembleSpec(
      chunks.map((c) => ({ content: c.content, ingested_at: c.ingestedAt })),
    );

    broken.push(...collectBrokenLinks(specPath, content, testChunks));
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
