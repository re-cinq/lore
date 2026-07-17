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
 * **This detector covers exactly the ladder's blind spot.** ADR-037's
 * `require-status-matches-coverage` rule already holds every header to what its
 * inline test links entitle it to claim, repo-wide, on every PR — so a header
 * that disagrees with its links cannot survive CI, and a detector re-checking
 * that would be both redundant and wrong (a half-linked spec sitting at
 * `In Progress` is exactly *correct* per the ladder, yet a naive "it has links,
 * so it shipped" rule would report it every week). What the ladder cannot see is
 * a spec that shipped without anyone writing the links: coverage says `Draft`,
 * the header agrees, the rule is satisfied, and the spec is still a lie. That is
 * the 20-of-22 case above. So the evidence here is deliberately the kind that
 * exists *outside* the links — merged spec-tasks, and named paths that are real.
 *
 * Runs as the `detect` node of the `status-staleness` assembly line, fanned out
 * weekly per spec-carrying repo by the `cron.status_staleness.tick` handler.
 *
 * Pure (no DB, no GitHub) helpers exported for unit tests:
 *   - namedPaths
 *   - specSlugFromPath
 *   - gatherEvidence
 *   - decideStale
 *   - formatStaleStatusReport
 *   - hasOpenStaleStatusIssue
 */

import {
  reassembleSpec,
  parseDocStatus,
  type Project,
  type StatusBucket,
} from "../index.js";
import type { DriftTaskRow } from "../project/tasks/task-store-port.js";
import { specsByPath } from "./spec-coverage-validate.js";
import { isAssertionSource } from "./spec-drift-rules.js";

const STALE_STATUS_LABEL = "stale-spec-status";

/** Statuses that can be stale. Terminal buckets (shipped/rejected/retired) can't. */
const CANDIDATE_STATUSES: StatusBucket[] = ["draft", "in-progress"];

/** `specs/<slug>/…` — the feature slug a spec path belongs to. */
const SPEC_SLUG_RE = /^specs\/([^/]+)\//;

/**
 * Statuses meaning a task is still going somewhere — the pending + running
 * families of `TaskStatus`. Everything else has settled: `merged` is the
 * evidence, while `completed` / `failed` / `cancelled` / `retried` are dead ends
 * that say nothing either way. Testing "not merged" instead would let a single
 * cancelled or retried sibling suppress the signal forever, and retries are
 * exactly what the messiest (so most likely stale) features accumulate.
 */
const IN_FLIGHT_TASK_STATUSES = [
  "pending",
  "queued",
  "awaiting_approval",
  "running",
  "running-local",
  "review",
  "pr-created",
];

/** A lone backticked path proves nothing — a spec naming several that all exist does. */
const MIN_NAMED_PATHS = 2;
const MIN_NAMED_PATH_RATIO = 0.5;

/** Specs listed per issue before the report truncates. */
const MAX_REPORTED_SPECS = 25;

export interface StaleEvidence {
  /** Linked pipeline tasks that merged. */
  mergedTasks: number;
  /** Linked pipeline tasks still in flight (pending or running). */
  outstandingTasks: number;
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
 * The feature slug a spec path belongs to — `specs/<slug>/spec.md` → `<slug>`,
 * the same key `specTaskRows` stamps into every spec-task's context bundle.
 * `null` for a spec living outside the `specs/` convention, which simply has no
 * task rows to find.
 */
export function specSlugFromPath(specPath: string): string | null {
  return specPath.match(SPEC_SLUG_RE)?.[1] ?? null;
}

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
 * Score one spec's implementation evidence. Pure: the caller supplies the indexed
 * code paths and the spec's linked task rows.
 *
 * Inline test links are deliberately not evidence — see the module header. The
 * ladder owns them, and it reads a half-linked spec as legitimately in progress.
 *
 * `knownPaths` comes from the last reindex, not the live default branch, so a
 * just-added file reads as missing for a day. That only costs findings (never
 * invents them), which is the right direction to err.
 */
export function gatherEvidence(
  content: string,
  knownPaths: Set<string>,
  taskRows: DriftTaskRow[],
): StaleEvidence {
  const paths = namedPaths(content);

  return {
    mergedTasks: taskRows.filter((t) => t.status === "merged").length,
    outstandingTasks: taskRows.filter((t) =>
      IN_FLIGHT_TASK_STATUSES.includes(t.status),
    ).length,
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

  if (evidence.mergedTasks > 0 && evidence.outstandingTasks === 0) {
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
    `${findings.length} spec${findings.length === 1 ? "" : "s"} still marked draft or in-progress carry evidence of being implemented — evidence that lives outside the test links, so \`require-status-matches-coverage\` cannot see it.`,
    "",
    "Add an inline `([validated by ...](path/to/test.ts#Lline))` link to each testable statement that already has a test. The status then follows automatically: the ladder raises a fully-linked spec to `Shipped`, and FR1 opens the flip PR. Editing the `| Status |` row on its own will fail CI — the rule holds the header to what the links support.",
    "",
    "If a spec here is genuinely still in progress, leave it; the evidence below is heuristic.",
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
  lines.push("");
  lines.push(
    "_Inline test links are not counted here: `require-status-matches-coverage` already holds every header to what its links entitle it to claim, on every PR. This job reports only what those links cannot record._",
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

/**
 * File the one aggregated report for a repo; returns how many issues were opened
 * (0 or 1). Skips when an open `stale-spec-status` issue already exists — this
 * runs weekly and would otherwise stack a duplicate every Monday. A read failure
 * leaves the list empty and we fall through to file: surfacing the staleness
 * beats silence, and a duplicate issue is the cheaper mistake.
 */
async function fileReport(
  project: Project,
  repo: string,
  findings: StaleFinding[],
): Promise<number> {
  const openIssues = await project.issues
    .list({ state: "open", labels: [STALE_STATUS_LABEL] })
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

    return 0;
  }

  try {
    const issue = await project.issues.create(
      "Stale spec statuses",
      formatStaleStatusReport(findings),
      [STALE_STATUS_LABEL, "lore-managed"],
    );

    console.log(
      `[job] status-staleness: ${repo} — ${findings.length} stale specs → issue ${issue.url}`,
    );

    return 1;
  } catch (err) {
    console.error(
      `[job] status-staleness: failed to file report for ${repo}:`,
      err,
    );

    return 0;
  }
}

/**
 * Every spec-task linked to the spec, or `[]` for a spec outside `specs/<slug>/`.
 *
 * `spec-task` is the only task type that links back to a spec at all, and
 * `spec_slug` is the only key it links by (`specTaskRows` / `syncTasksToDb`
 * write it; nothing writes `spec_path` onto a spec-task). `implementation` rows
 * are deliberately not consulted: the review-fix loop is their only creator and
 * its bundle holds a branch and a parent task id, nothing spec-shaped.
 */
async function linkedTasks(
  project: Project,
  specPath: string,
): Promise<DriftTaskRow[]> {
  const slug = specSlugFromPath(specPath);

  return slug ? project.tasks.specTasksForSlug(slug) : [];
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

  // Every `code` chunk in the repo's resolved schema — the name reflects the
  // first caller, not the filter; only the paths are used here.
  // Deliberately not `chunks.codeSymbols()`, which is hardcoded to
  // `org_shared.chunks` while the spec reads above resolve the team schema — on
  // a team-schema repo that mismatch returns zero paths, silently killing the
  // named-paths signal rather than failing.
  const codeChunks = await project.chunks.testChunkRanges();
  const knownPaths = new Set(codeChunks.map((c) => c.filePath));

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

  const reportsOpened =
    findings.length > 0 ? await fileReport(project, repo, findings) : 0;

  const summary = `Checked ${candidates} draft/in-progress specs in ${repo} — ${findings.length} look implemented, ${reportsOpened} reports opened`;

  console.log(`[job] status-staleness: ${summary}`);

  return summary;
}
