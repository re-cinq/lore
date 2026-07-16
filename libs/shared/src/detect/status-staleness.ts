/**
 * Status-staleness detection — spec-status-upkeep FR2 (ADR-037).
 *
 * FR1 flips a spec's `| Status |` header the moment a feature's last spec-task
 * merges, but that only covers pipeline-driven work. Human-driven and
 * interactive work bypasses the pipeline, and convention alone rots: a
 * 2026-07-14 audit found 20 of 22 Draft/In-Progress specs were already
 * implemented and live. This is the weekly safety net, so a stale header
 * survives at most one week rather than a quarter.
 *
 * For every spec still bucketing to `draft` or `in-progress`, gather
 * implementation evidence and report the ones that look shipped. Deterministic
 * — no LLM. Every signal comes from chunks and task rows, all of which a station
 * pod can read over HTTP (a pod has no `project.repo.read`, which is also why
 * this files an issue rather than a status-flip PR).
 *
 * Runs as the `detect` node of the `status-staleness` assembly line, fanned out
 * weekly per spec-carrying repo by the `cron.status_staleness.tick` handler.
 *
 * Pure (no DB, no GitHub) helpers exported for unit tests:
 *   - namedPaths
 *   - gatherEvidence
 *   - decideStale
 *   - formatStaleStatusReport
 *   - hasOpenStaleStatusIssue
 */

import {
  linksForStatements,
  reassembleSpec,
  parseDocStatus,
  type Project,
  type StatusBucket,
} from "../index.js";
import type { DriftTaskRow } from "../project/tasks/task-store-port.js";
import {
  resolveTestLink,
  specsByPath,
  type ChunkLineRange,
} from "./spec-coverage-validate.js";
import { isAssertionSource } from "./spec-drift-rules.js";

const STALE_STATUS_LABEL = "stale-spec-status";

/** Statuses that can be stale. Terminal buckets (shipped/rejected/retired) can't. */
const CANDIDATE_STATUSES: StatusBucket[] = ["draft", "in-progress"];

/** Task types whose merge is evidence the spec's feature actually shipped. */
const IMPLEMENTING_TASK_TYPES = ["spec-task", "implementation"];

/** A lone backticked path proves nothing — a spec naming several that all exist does. */
const MIN_NAMED_PATHS = 2;
const MIN_NAMED_PATH_RATIO = 0.5;

/** Specs listed per issue before the report truncates. */
const MAX_REPORTED_SPECS = 25;

export interface StaleEvidence {
  /** Inline `([validated by ...])` links resolving to a real test chunk. */
  resolvingTestLinks: number;
  /** Linked pipeline tasks that merged. */
  mergedTasks: number;
  /** Linked pipeline tasks that have not merged (any other status). */
  unmergedTasks: number;
  /** Backticked paths the spec names that exist in the indexed code. */
  namedPathsExisting: number;
  namedPathsTotal: number;
}

export interface StaleFinding {
  specPath: string;
  status: StatusBucket;
  evidence: StaleEvidence;
  /** Human-readable signals that fired; non-empty for a finding. */
  reasons: string[];
}

// ── Pure helpers ────────────────────────────────────────────────────

/**
 * Repo-relative file paths a spec names in backticked code spans, deduped.
 * Deliberately narrow: a span only counts when it has a directory separator and
 * a short file extension, so prose spans (`Status`, `draft`) and bare symbols
 * never read as paths.
 */
export function namedPaths(content: string): string[] {
  const found = new Set<string>();

  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1].trim();

    if (
      span.includes("/") &&
      !span.includes(" ") &&
      /\.[a-z]{1,4}$/.test(span)
    ) {
      found.add(span.replace(/^\.\//, ""));
    }
  }

  return [...found];
}

/**
 * Score one spec's implementation evidence. Pure: the caller supplies the test
 * chunk ranges, the indexed code paths, and the spec's linked task rows.
 *
 * `knownPaths` comes from the last reindex, not the live default branch, so a
 * just-added file reads as missing for a day. That only costs findings (never
 * invents them), which is the right direction to err.
 */
export function gatherEvidence(
  content: string,
  testChunks: ChunkLineRange[],
  knownPaths: Set<string>,
  taskRows: DriftTaskRow[],
): StaleEvidence {
  let resolvingTestLinks = 0;

  for (const { testLinks } of linksForStatements(content)) {
    for (const link of testLinks) {
      if (resolveTestLink(link, testChunks).ok) {
        resolvingTestLinks++;
      }
    }
  }

  const paths = namedPaths(content);
  const merged = taskRows.filter((t) => t.status === "merged").length;

  return {
    resolvingTestLinks,
    mergedTasks: merged,
    unmergedTasks: taskRows.length - merged,
    namedPathsExisting: paths.filter((p) => knownPaths.has(p)).length,
    namedPathsTotal: paths.length,
  };
}

/**
 * The signals that fired, phrased for the issue body. Empty means the spec's
 * draft/in-progress header is honest — the healthy steady state.
 */
export function decideStale(evidence: StaleEvidence): string[] {
  const reasons: string[] = [];

  if (evidence.resolvingTestLinks > 0) {
    const one = evidence.resolvingTestLinks === 1;

    reasons.push(
      `${evidence.resolvingTestLinks} inline test link${one ? "" : "s"} ${one ? "resolves" : "resolve"} to real tests`,
    );
  }

  if (evidence.mergedTasks > 0 && evidence.unmergedTasks === 0) {
    reasons.push(
      `${evidence.mergedTasks} linked pipeline task${evidence.mergedTasks === 1 ? "" : "s"} merged, none outstanding`,
    );
  }

  if (
    evidence.namedPathsTotal >= MIN_NAMED_PATHS &&
    evidence.namedPathsExisting / evidence.namedPathsTotal >=
      MIN_NAMED_PATH_RATIO
  ) {
    reasons.push(
      `${evidence.namedPathsExisting} of the ${evidence.namedPathsTotal} paths it names exist in the code`,
    );
  }

  return reasons;
}

export function formatStaleStatusReport(findings: StaleFinding[]): string {
  if (findings.length === 0) {
    return "";
  }
  const shown = findings.slice(0, MAX_REPORTED_SPECS);
  const lines: string[] = [
    "**Specs whose status header looks stale**",
    "",
    `${findings.length} spec${findings.length === 1 ? "" : "s"} still marked draft or in-progress carry evidence of being implemented. Flip the \`| Status |\` row to \`Implemented\`, or correct the evidence.`,
    "",
  ];

  for (const finding of shown) {
    lines.push(`### \`${finding.specPath}\``);
    lines.push("");
    lines.push(`Header says **${finding.status}**, but:`);

    for (const reason of finding.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
  }

  if (findings.length > shown.length) {
    lines.push(`_…and ${findings.length - shown.length} more._`);
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "Posted by Lore's `status-staleness` job (spec-status-upkeep FR2, ADR-037). Evidence is heuristic — a spec legitimately mid-flight can carry all of it. Close this once the headers are honest.",
  );

  return lines.join("\n");
}

/** True when the repo already has an open stale-spec-status issue, so the weekly
 *  run doesn't file a duplicate on top of an unaddressed one. */
export function hasOpenStaleStatusIssue(
  openIssues: { labels: string[] }[],
): boolean {
  return openIssues.some((i) => i.labels.includes(STALE_STATUS_LABEL));
}

// ── Orchestration (per repo, via the Project facade) ────────────────

export interface StatusStalenessOptions {
  /** The repo this run covers. The fan-out (jobs/detect) enumerates repos with
   *  specs and starts one assembly-line run per repo. */
  repoFilter: string;
  /** The data facade to read/write through. Floor-side this is projectFor(repo)
   *  (Postgres); in a station pod it is createStationProject(repo) (HTTP, no DB). */
  project: Project;
}

/** Every implementing task linked to the spec, across the task types that count. */
async function linkedTasks(
  project: Project,
  specPath: string,
): Promise<DriftTaskRow[]> {
  const perType = await Promise.all(
    IMPLEMENTING_TASK_TYPES.map((taskType) =>
      project.tasks.driftTasksForSpec(taskType, specPath),
    ),
  );

  return perType.flat();
}

export async function statusStalenessJob(
  opts: StatusStalenessOptions,
): Promise<string> {
  const repo = opts.repoFilter;
  const project = opts.project;

  const specs = await project.chunks.specChunksWithIngest();

  if (specs.length === 0) {
    console.log(`[job] status-staleness: no specs for ${repo}`);

    return "No specs found";
  }

  const testChunks: ChunkLineRange[] = (
    await project.chunks.testChunkRanges()
  ).map((c) => ({
    file_path: c.filePath,
    start_line: c.startLine,
    end_line: c.endLine,
  }));
  const knownPaths = new Set(
    (await project.chunks.codeSymbols()).map((c) => c.filePath),
  );

  const findings: StaleFinding[] = [];
  let candidates = 0;

  for (const [specPath, chunks] of specsByPath(specs)) {
    // Prose artifacts (research/plan/tasks/quickstart) carry no status header of
    // their own — only spec.md-shaped docs are worth reading.
    if (!isAssertionSource(specPath)) {
      continue;
    }
    const content = reassembleSpec(
      chunks.map((c) => ({ content: c.content, ingested_at: c.ingestedAt })),
    );
    const { status } = parseDocStatus(content, "spec");

    if (status === null || !CANDIDATE_STATUSES.includes(status)) {
      continue;
    }
    candidates++;

    try {
      const evidence = gatherEvidence(
        content,
        testChunks,
        knownPaths,
        await linkedTasks(project, specPath),
      );
      const reasons = decideStale(evidence);

      if (reasons.length > 0) {
        findings.push({ specPath, status, evidence, reasons });
      }
    } catch (err) {
      console.error(
        `[job] status-staleness: error processing ${repo}:${specPath}:`,
        err,
      );
    }
  }

  let reportsOpened = 0;

  if (findings.length > 0) {
    // Dedup: skip filing when an open stale-spec-status issue already exists —
    // this runs weekly and would otherwise stack a duplicate every Monday. A read
    // failure leaves openIssues empty and we fall through to file; surfacing the
    // staleness beats silence.
    try {
      const openIssues = await project.issues
        .list({ state: "open" })
        .catch((err) => {
          console.error(
            `[job] status-staleness: open-issue read failed for ${repo}:`,
            err,
          );

          return [] as Awaited<ReturnType<typeof project.issues.list>>;
        });

      if (hasOpenStaleStatusIssue(openIssues)) {
        console.log(
          `[job] status-staleness: ${repo} — ${findings.length} stale specs, open ${STALE_STATUS_LABEL} issue exists, skipping`,
        );
      } else {
        const issue = await project.issues.create(
          "Stale spec statuses",
          formatStaleStatusReport(findings),
          [STALE_STATUS_LABEL, "lore-managed"],
        );

        reportsOpened++;
        console.log(
          `[job] status-staleness: ${repo} — ${findings.length} stale specs → issue ${issue.url}`,
        );
      }
    } catch (err) {
      console.error(
        `[job] status-staleness: failed to file report for ${repo}:`,
        err,
      );
    }
  }

  const summary = `Checked ${candidates} draft/in-progress specs in ${repo} — ${findings.length} look implemented, ${reportsOpened} reports opened`;

  console.log(`[job] status-staleness: ${summary}`);

  return summary;
}
