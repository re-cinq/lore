import { OPEN_TASK_STATES } from "@re-cinq/lore-shared/project/tasks/task-store-port.js";
import { query } from "../../../kernel/db.js";
import { taskStore } from "../../../kernel/queues.js";

interface OnboardedRepo {
  id: string;
  full_name: string;
  last_ingested_at: Date | null;
}

interface GapReport {
  repo: string;
  type: string;
  detail: string;
}

const STALE_DAYS = 90;

export interface GapDetectOptions {
  /** The onboarded repo this run covers (per-repo assembly-line fan-out). */
  repoFilter: string;
}

/**
 * Gap Detection Job — one repo per run.
 *
 * Runs as the `detect` node of the `gap-detect` assembly line, fanned out
 * weekly per onboarded repo by the `cron.gap_detection.tick` handler. Checks
 * the repo for missing or stale context:
 * 1. Missing CLAUDE.md (fixed: query content_type='doc' + file_path LIKE)
 * 2. Missing ADRs (repos with 0 adr chunks)
 * 3. Missing specs (active repos with 0 spec chunks)
 * 4. Stale content (chunks not re-ingested in >90 days)
 */
export async function gapDetectJob(opts: GapDetectOptions): Promise<string> {
  const repos = await query<OnboardedRepo>(
    `SELECT id, full_name, last_ingested_at
     FROM lore.repos
     WHERE onboarding_pr_merged = true AND full_name = $1`,
    [opts.repoFilter],
  );

  const gaps: GapReport[] = [];

  for (const repo of repos) {
    try {
      await checkMissingClaudeMd(repo, gaps);
      await checkMissingAdrs(repo, gaps);
      await checkMissingSpecs(repo, gaps);
      await checkStaleContent(repo, gaps);
    } catch (err) {
      console.error(
        `[job] gap-detect: error checking ${repo.full_name}:`,
        err,
      );
    }
  }

  // Create pipeline tasks for each gap (skip if a duplicate is already in flight).
  // Goes through taskStore().create so the trust-level gate + created_by provenance
  // apply — the old inline INSERT bypassed both. Dedup suppresses a refile while a
  // matching task is open (the shared in-flight set) or already failed.
  let created = 0;
  const dedupStatuses = [...OPEN_TASK_STATES, "failed"];
  for (const gap of gaps) {
    try {
      const desc = `Gap: ${gap.type} — ${gap.detail}`;

      const existing = await taskStore().findOpenLike({
        repo: gap.repo,
        taskType: "gap-fill",
        descriptionPrefix: `Gap: ${gap.type}`,
        statuses: dedupStatuses,
      });
      if (existing.length > 0) continue;

      await taskStore().create({
        description: desc,
        taskType: "gap-fill",
        targetRepo: gap.repo,
        createdBy: "gap-detect",
      });
      created++;
    } catch (err) {
      console.error(`[job] gap-detect: error creating task for ${gap.repo}:`, err);
    }
  }

  const summary = `Checked ${repos.length} repos, ${gaps.length} gaps detected, ${created} tasks created`;
  console.log(`[job] gap-detect: ${summary}`);
  return summary;
}

async function checkMissingClaudeMd(
  repo: OnboardedRepo,
  gaps: GapReport[],
): Promise<void> {
  const chunks = await query<{ id: string }>(
    `SELECT id FROM org_shared.chunks
     WHERE repo = $1
       AND content_type = 'doc'
       AND file_path LIKE '%CLAUDE.md'
     LIMIT 1`,
    [repo.full_name],
  );

  if (chunks.length === 0) {
    console.log(`[job] gap-detect: ${repo.full_name} missing CLAUDE.md`);
    gaps.push({
      repo: repo.full_name,
      type: "missing-claude-md",
      detail: `${repo.full_name} has no CLAUDE.md in context`,
    });
  }
}

async function checkMissingAdrs(
  repo: OnboardedRepo,
  gaps: GapReport[],
): Promise<void> {
  const chunks = await query<{ id: string }>(
    `SELECT id FROM org_shared.chunks
     WHERE repo = $1 AND content_type = 'adr'
     LIMIT 1`,
    [repo.full_name],
  );

  if (chunks.length === 0) {
    console.log(`[job] gap-detect: ${repo.full_name} has no ADRs`);
    gaps.push({
      repo: repo.full_name,
      type: "missing-adrs",
      detail: `${repo.full_name} has no architecture decision records`,
    });
  }
}

async function checkMissingSpecs(
  repo: OnboardedRepo,
  gaps: GapReport[],
): Promise<void> {
  const chunks = await query<{ id: string }>(
    `SELECT id FROM org_shared.chunks
     WHERE repo = $1 AND content_type = 'spec'
     LIMIT 1`,
    [repo.full_name],
  );

  if (chunks.length === 0) {
    console.log(`[job] gap-detect: ${repo.full_name} has no specs`);
    gaps.push({
      repo: repo.full_name,
      type: "missing-specs",
      detail: `${repo.full_name} has no spec files in context`,
    });
  }
}

async function checkStaleContent(
  repo: OnboardedRepo,
  gaps: GapReport[],
): Promise<void> {
  const stale = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM org_shared.chunks
     WHERE repo = $1
       AND ingested_at < NOW() - ($2 || ' days')::interval`,
    [repo.full_name, String(STALE_DAYS)],
  );

  const staleCount = parseInt(stale[0]?.count || "0", 10);
  if (staleCount > 10) {
    console.log(
      `[job] gap-detect: ${repo.full_name} has ${staleCount} stale chunks (>${STALE_DAYS} days)`,
    );
    gaps.push({
      repo: repo.full_name,
      type: "stale-content",
      detail: `${repo.full_name} has ${staleCount} chunks not re-ingested in >${STALE_DAYS} days`,
    });
  }
}

