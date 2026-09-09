import { OPEN_TASK_STATES } from "../../outbound/project/tasks/task-store-port.js";
import type { Project } from "../../outbound/project/lib/project.js";

interface GapReport {
  repo: string;
  type: string;
  detail: string;
}

export interface GapDetectOptions {
  /** The onboarded repo this run covers (per-repo assembly-line fan-out). */
  repoFilter: string;
  /** Data facade to read/write through — projectFor(repo) on the Floor, createStationProject(env) in a pod. */
  project: Project;
}

/** Gap Detection Job: the `detect` node of `gap-detect`, fanned out weekly per repo by cron.gap_detection.tick; checks CLAUDE.md/ADRs/specs presence through the Project facade so it runs unchanged on the Floor or in a station pod. */
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

/** The three kinds of context a repo can simply be missing, as data: each names the chunk whose absence is the gap and the sentence that reports it. */
const MISSING_CONTENT_CHECKS: Array<{
  type: GapReport["type"];
  chunkType: string;
  path?: string;
  detail: (repo: string) => string;
}> = [
  {
    type: "missing-claude-md",
    chunkType: "doc",
    path: "CLAUDE.md",
    detail: (repo) => `${repo} has no CLAUDE.md in context`,
  },
  {
    type: "missing-adrs",
    chunkType: "adr",
    detail: (repo) => `${repo} has no architecture decision records`,
  },
  {
    type: "missing-specs",
    chunkType: "spec",
    detail: (repo) => `${repo} has no spec files in context`,
  },
];

async function detectGaps(
  repo: string,
  project: Project,
): Promise<GapReport[]> {
  const gaps: GapReport[] = [];

  try {
    gaps.push(...(await missingContent(repo, project)));
  } catch (err) {
    console.error(`[job] gap-detect: error checking ${repo}:`, err);
  }

  return gaps;
}

/** Checked against the INGESTED chunks rather than the repo's files: a CLAUDE.md that exists but was never ingested is invisible to every agent, which is the gap this reports. */
async function missingContent(
  repo: string,
  project: Project,
): Promise<GapReport[]> {
  const gaps: GapReport[] = [];

  for (const check of MISSING_CONTENT_CHECKS) {
    if (await project.chunks.hasChunk(check.chunkType, check.path)) {
      continue;
    }
    gaps.push({ repo, type: check.type, detail: check.detail(repo) });
  }

  return gaps;
}

/** Files every detected gap; one failing gap must not cost the run the rest of them, so the catch is per gap. */
async function fileGaps(gaps: GapReport[], project: Project): Promise<number> {
  let created = 0;
  const dedupStatuses = [...OPEN_TASK_STATES, "failed"];

  for (const gap of gaps) {
    try {
      created += await fileGap(gap, project, dedupStatuses);
    } catch (err) {
      console.error(
        `[job] gap-detect: error creating task for ${gap.repo}:`,
        err,
      );
    }
  }

  return created;
}

async function fileGap(
  gap: GapReport,
  project: Project,
  dedupStatuses: string[],
): Promise<number> {
  if (await gapAlreadyFiled(gap, project, dedupStatuses)) {
    return 0;
  }

  await project.tasks.create({
    description: `Gap: ${gap.type} — ${gap.detail}`,
    taskType: "gap-fill",
    targetRepo: gap.repo,
    createdBy: "gap-detect",
  });

  return 1;
}

/** One gap-fill task via project.tasks.create (trust-level gate + created_by provenance apply); findOpenLike dedups against an in-flight or failed matching task. Answers how many tasks were created — 1, or 0 when one already tracks this gap. */
async function gapAlreadyFiled(
  gap: GapReport,
  project: Project,
  dedupStatuses: string[],
): Promise<boolean> {
  const existing = await project.tasks.findOpenLike({
    repo: gap.repo,
    taskType: "gap-fill",
    descriptionPrefix: `Gap: ${gap.type}`,
    statuses: dedupStatuses,
  });

  return existing.length > 0;
}
