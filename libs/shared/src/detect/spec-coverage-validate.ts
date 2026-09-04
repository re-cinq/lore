/** Validates spec-test-coverage v3 inline links (`Statement. ([label](test.ts#L42))`) against `{schema}.chunks`; runs post-ingest + daily, files a deduped `spec-link-rot` issue. */

import {
  dropIngestExcluded,
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
  /** When the chunk was last ingested/verified; absent means "unknown" (keeps the strict pre-freshness judgment). */
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

  // A file whose chunks carry no line ranges (pre-v2 chunker output) is unverifiable, not broken.
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

/** A line past the file's last ranged line, on chunks ingested before the linking spec, is index lag not rot — the daily rerun re-judges once chunks catch up. */
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

function brokenLinksForStatement(
  {
    path: specPath,
    ingestedAt: specIngestedAt,
  }: { path: string; ingestedAt?: string | Date | null },
  statementText: string,
  testLinks: TestLinkRef[],
  chunks: ChunkLineRange[],
): BrokenLink[] {
  const out: BrokenLink[] = [];

  for (const link of testLinks) {
    // Chunk file_paths are repo-root-relative; a `../` href is spec-directory-relative (GitHub-render semantics) and must be canonicalized before matching.
    const resolved: TestLinkRef = {
      ...link,
      path: resolveLinkPath(link.path, specPath),
    };
    const r = resolveTestLink(resolved, chunks, specIngestedAt);

    if (!r.ok) {
      out.push({
        spec_path: specPath,
        statement_text: statementText,
        link: resolved,
        reason: r.reason,
      });
    }
  }

  for (const link of findMisplacedCoverageLinks(statementText)) {
    out.push({
      spec_path: specPath,
      statement_text: statementText,
      link: { ...link, path: resolveLinkPath(link.path, specPath) },
      reason: "non-trailing-link",
    });
  }

  return out;
}

export function collectBrokenLinks(
  specPath: string,
  content: string,
  chunks: ChunkLineRange[],
  specIngestedAt?: string | Date | null,
): BrokenLink[] {
  const out: BrokenLink[] = [];

  for (const { statement, testLinks } of linksForStatements(content)) {
    out.push(
      ...brokenLinksForStatement(
        { path: specPath, ingestedAt: specIngestedAt },
        statement.text,
        testLinks,
        chunks,
      ),
    );
  }

  return out;
}

/** GitHub rejects issue bodies over 65,536 chars; leave headroom for the footer. */
const MAX_ISSUE_BODY = 60_000;

function sectionBulletsWithinBudget(
  list: BrokenLink[],
  startBudget: number,
): { bullets: string[]; sectionBudget: number; elided: number } {
  const bullets: string[] = [];
  let sectionBudget = startBudget;
  let elided = 0;

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

  return { bullets, sectionBudget, elided };
}

function groupBrokenLinksBySpec(
  broken: BrokenLink[],
): Map<string, BrokenLink[]> {
  const bySpec = new Map<string, BrokenLink[]>();

  for (const b of broken) {
    const list = bySpec.get(b.spec_path) ?? [];

    list.push(b);
    bySpec.set(b.spec_path, list);
  }

  return bySpec;
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

function reportHeaderLines(broken: BrokenLink[], specCount: number): string[] {
  return [
    "**Broken or misplaced test links detected**",
    "",
    `${broken.length} link${pluralSuffix(broken.length)} across ${specCount} spec${pluralSuffix(specCount)} don't resolve to a known test chunk or sit outside the trailing parenthetical.`,
    "",
  ];
}

interface SpecSectionsResult {
  lines: string[];
  elided: number;
}

// Whole bullets only, up to the budget — a raw slice could cut mid-line and drop the footer.
function renderSpecSections(
  bySpec: Map<string, BrokenLink[]>,
  startBudget: number,
): SpecSectionsResult {
  const lines: string[] = [];
  let budget = startBudget;
  let elided = 0;

  for (const [specPath, list] of bySpec) {
    const heading = `### \`${specPath}\``;

    if (budget + heading.length > MAX_ISSUE_BODY) {
      elided += list.length;
      continue;
    }

    const section = sectionBulletsWithinBudget(
      list,
      budget + heading.length + 2,
    );

    elided += section.elided;

    // Every bullet was elided — a dangling empty heading would misread as a clean spec.
    if (section.bullets.length === 0) {
      continue;
    }
    lines.push(heading, "", ...section.bullets, "");
    budget = section.sectionBudget + 1;
  }

  return { lines, elided };
}

export function formatBrokenLinksReport(broken: BrokenLink[]): string {
  if (broken.length === 0) {
    return "";
  }
  const bySpec = groupBrokenLinksBySpec(broken);
  const lines = reportHeaderLines(broken, bySpec.size);
  const sections = renderSpecSections(bySpec, lines.join("\n").length);

  lines.push(...sections.lines);

  if (sections.elided > 0) {
    lines.push(
      `_…and ${sections.elided} more broken link(s) truncated — see the job logs._`,
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

/** True when the repo already has an open spec-link-rot issue, avoiding a duplicate on every daily + per-ingest run. */
export function hasOpenLinkRotIssue(
  openIssues: { labels: string[] }[],
): boolean {
  return openIssues.some((i) => i.labels.includes(LINK_ROT_LABEL));
}

// ── Orchestration (per repo, via the Project facade) ────────────────

export interface ValidateOptions {
  /** The repo whose specs are validated, set by the detect fan-out or post-ingest trigger. */
  repoFilter: string;
  /** Data facade — projectFor(repo) on the Floor, createStationProject(env) in a pod. */
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

/** Newest ingest stamp across a spec's chunks, compared against test-chunk stamps to spot index lag. */
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

  // Both reads pass through dropIngestExcluded: excluded-path chunks may linger from before the exclusion existed and their fake links must not surface as rot (#1018).
  const specs = dropIngestExcluded(await project.chunks.specChunksWithIngest());

  if (specs.length === 0) {
    console.log(`[job] spec-coverage-validate: no specs for ${repo}`);

    return "No specs found";
  }

  const testChunks: ChunkLineRange[] = dropIngestExcluded(
    await project.chunks.testChunkRanges(),
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
    reportsOpened = await fileLinkRotReport(project, repo, broken);
  }

  const summary = `Checked ${totalSpecs} specs in ${repo} — ${broken.length} broken links, ${reportsOpened} reports opened`;

  console.log(`[job] spec-coverage-validate: ${summary}`);

  return summary;
}

/** Files a spec-link-rot issue unless an open one exists; a read failure falls through to file, since surfacing rot beats silence. Returns 0 or 1. */
async function fileLinkRotReport(
  project: Project,
  repo: string,
  broken: BrokenLink[],
): Promise<number> {
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

      return 0;
    }

    const issue = await project.issues.create(
      "Broken test links in spec.md",
      formatBrokenLinksReport(broken),
      [LINK_ROT_LABEL, "lore-managed"],
    );

    console.log(
      `[job] spec-coverage-validate: ${repo} — ${broken.length} broken links → issue ${issue.url}`,
    );

    return 1;
  } catch (err) {
    console.error(
      `[job] spec-coverage-validate: failed to file report for ${repo}:`,
      err,
    );

    return 0;
  }
}
