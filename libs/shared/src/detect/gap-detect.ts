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
  /** Data facade to read/write through — projectFor(repo) on the Floor, createStationProject(env) in a pod. */
  project: Project;
}

/** Gap Detection Job: the `detect` node of `gap-detect`, fanned out weekly per repo by cron.gap_detection.tick; checks CLAUDE.md/ADRs/specs presence + stale reindex content (>90d unverified), through the Project facade so it runs unchanged on the Floor or in a station pod. */
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
        detail: `${repo} has ${staleCount} chunks not verified by reindex in >${STALE_DAYS} days`,
      });
    }
  } catch (err) {
    console.error(`[job] gap-detect: error checking ${repo}:`, err);
  }

  return gaps;
}

/** Files a gap-fill task per gap via project.tasks.create (trust-level gate + created_by provenance apply); findOpenLike dedups against an in-flight or failed matching task. */
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
