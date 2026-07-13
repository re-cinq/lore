import { OPEN_TASK_STATES } from "../project/tasks/task-store-port.js";
import type { Project } from "../index.js";

interface GapReport {
  repo: string;
  type: string;
  detail: string;
}

const STALE_DAYS = 90;
/** More than this many stale chunks trips the stale-content gap. */
const STALE_CHUNK_FLOOR = 10;

export interface GapDetectOptions {
  /** The onboarded repo this run covers (per-repo assembly-line fan-out). */
  repoFilter: string;
  /** Data facade to read/write through — projectFor(repo) on the Floor,
   *  createStationProject(env) in a pod. Defaults to projectFor(repo). */
  project: Project;
}

/**
 * Gap Detection Job — one repo per run.
 *
 * Runs as the `detect` node of the `gap-detect` assembly line, fanned out
 * weekly per onboarded repo by the `cron.gap_detection.tick` handler. Reads and
 * files entirely through the Project facade so it runs unchanged on the Floor
 * (Postgres) and in a station pod (HTTP, no DB). Checks the repo for:
 * 1. Missing CLAUDE.md (doc chunk with a `%CLAUDE.md` path)
 * 2. Missing ADRs (0 adr chunks)
 * 3. Missing specs (0 spec chunks)
 * 4. Stale content (chunks not re-ingested in >90 days)
 */
export async function gapDetectJob(opts: GapDetectOptions): Promise<string> {
  const repo = opts.repoFilter;
  const project = opts.project;

  if (!(await project.settings.isOnboarded())) {
    console.log(`[job] gap-detect: ${repo} is not onboarded — skipping`);

    return `Repo ${repo} not onboarded`;
  }

  const gaps = await detectGaps(repo, project);
  const created = await fileGaps(gaps, project);

  const summary = `Checked ${repo}, ${gaps.length} gaps detected, ${created} tasks created`;

  console.log(`[job] gap-detect: ${summary}`);

  return summary;
}

async function detectGaps(
  repo: string,
  project: Project,
): Promise<GapReport[]> {
  const gaps: GapReport[] = [];

  try {
    if (!(await project.chunks.hasChunk("doc", "CLAUDE.md"))) {
      gaps.push({
        repo,
        type: "missing-claude-md",
        detail: `${repo} has no CLAUDE.md in context`,
      });
    }

    if (!(await project.chunks.hasChunk("adr"))) {
      gaps.push({
        repo,
        type: "missing-adrs",
        detail: `${repo} has no architecture decision records`,
      });
    }

    if (!(await project.chunks.hasChunk("spec"))) {
      gaps.push({
        repo,
        type: "missing-specs",
        detail: `${repo} has no spec files in context`,
      });
    }
    const staleCount = await project.chunks.staleChunkCount(STALE_DAYS);

    if (staleCount > STALE_CHUNK_FLOOR) {
      gaps.push({
        repo,
        type: "stale-content",
        detail: `${repo} has ${staleCount} chunks not re-ingested in >${STALE_DAYS} days`,
      });
    }
  } catch (err) {
    console.error(`[job] gap-detect: error checking ${repo}:`, err);
  }

  return gaps;
}

/**
 * File a gap-fill task per gap. Goes through project.tasks.create so the
 * trust-level gate + created_by provenance apply; findOpenLike dedups against an
 * in-flight or failed matching task.
 */
async function fileGaps(gaps: GapReport[], project: Project): Promise<number> {
  let created = 0;
  const dedupStatuses = [...OPEN_TASK_STATES, "failed"];

  for (const gap of gaps) {
    try {
      const existing = await project.tasks.findOpenLike({
        repo: gap.repo,
        taskType: "gap-fill",
        descriptionPrefix: `Gap: ${gap.type}`,
        statuses: dedupStatuses,
      });

      if (existing.length > 0) {
        continue;
      }

      await project.tasks.create({
        description: `Gap: ${gap.type} — ${gap.detail}`,
        taskType: "gap-fill",
        targetRepo: gap.repo,
        createdBy: "gap-detect",
      });
      created++;
    } catch (err) {
      console.error(
        `[job] gap-detect: error creating task for ${gap.repo}:`,
        err,
      );
    }
  }

  return created;
}
