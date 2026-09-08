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

/** The three kinds of context a repo can simply be missing. Checked against the INGESTED chunks rather than the repo's files: a CLAUDE.md that exists but was never ingested is invisible to every agent, which is the gap this reports. */
async function missingContent(
  repo: string,
  project: Project,
): Promise<GapReport[]> {
  const checks: Array<[GapReport["type"], boolean, string]> = [
    [
      "missing-claude-md",
      await project.chunks.hasChunk("doc", "CLAUDE.md"),
      `${repo} has no CLAUDE.md in context`,
    ],
    [
      "missing-adrs",
      await project.chunks.hasChunk("adr"),
      `${repo} has no architecture decision records`,
    ],
    [
      "missing-specs",
      await project.chunks.hasChunk("spec"),
      `${repo} has no spec files in context`,
    ],
  ];

  return checks
    .filter(([, present]) => !present)
    .map(([type, , detail]) => ({ repo, type, detail }));
}

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
