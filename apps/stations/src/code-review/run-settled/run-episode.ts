// What a settled run leaves in agent memory: one episode naming the run and what each of its agents concluded, so fact extraction learns from the run rather than from its whole transcript.
import type { Handle, Report } from "@re-cinq/floor-station";
import type { RunView, VisitView } from "@re-cinq/floor-client";
import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import { errorMessage } from "@re-cinq/lore-shared";
import { loreRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { startValueOf } from "./run-settled.js";

const VALUE_LIMIT = 1000;
const EPISODE_LIMIT = 4000;
const BLOB_REF = /^sha256-[0-9a-f]{64}$/;

/** One finished agent visit: what it produced, each blob already read as the text it ends on. */
export interface AgentReport {
  nodeId: string;
  iteration: number;
  outcome: string;
  error?: string;
  produced: Record<string, string>;
}

export interface RunEpisode {
  repo: string;
  agentId: string;
  content: string;
}

export interface RunEpisodeDeps {
  run(runId: string): Promise<RunView | null>;
  agentReports(runId: string): Promise<AgentReport[]>;
  post(episode: RunEpisode): Promise<void>;
  warn(message: string): void;
}

/** A cancelled run is a closed or superseded subject, and a run no agent worked on has nothing to learn from. */
export function runEpisodeOf(
  run: RunView,
  reports: AgentReport[],
): RunEpisode | null {
  if (run.outcome === "cancelled" || reports.length === 0) {
    return null;
  }
  const repo = loreRepoOf(run.repo);
  const content = [headerLines(run, repo), ...reports.map(reportLines)]
    .map((lines) => lines.join("\n"))
    .join("\n\n");

  return {
    repo,
    agentId: `floor/${run.lineId}`,
    content: clipped(content, EPISODE_LIMIT),
  };
}

function headerLines(run: RunView, repo: string): string[] {
  const prUrl = startValueOf(run, "pr_url");

  return [
    `Run ${run.id} of ${run.lineId} on ${repo} ended as ${run.outcome}.`,
    ...(run.reason ? [`Reason: ${run.reason}`] : []),
    ...(prUrl ? [`Pull request: ${prUrl}`] : []),
  ];
}

function reportLines(report: AgentReport): string[] {
  const said = report.error
    ? [["error", report.error]]
    : Object.entries(report.produced);

  return [
    `${report.nodeId} #${report.iteration} (${report.outcome})`,
    ...said.map(([name, value]) => `${name}: ${clipped(value, VALUE_LIMIT)}`),
  ];
}

function clipped(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** The finished agent visits of a run; a produced blob is read as the result text of the output it holds, and one the floor no longer holds is left out. */
export async function agentReportsOf(
  visits: VisitView[],
  readBlob: (hash: string) => Promise<string | null>,
): Promise<AgentReport[]> {
  return Promise.all(
    visits.flatMap((visit) =>
      visit.agentSettings && visit.report
        ? [agentReportOf(visit, visit.report, readBlob)]
        : [],
    ),
  );
}

async function agentReportOf(
  visit: VisitView,
  report: Report,
  readBlob: (hash: string) => Promise<string | null>,
): Promise<AgentReport> {
  return {
    nodeId: visit.nodeId,
    iteration: visit.iteration,
    outcome: report.outcome,
    ...(report.error ? { error: report.error } : {}),
    produced: await producedText(report.produced ?? {}, readBlob),
  };
}

async function producedText(
  produced: Record<string, string>,
  readBlob: (hash: string) => Promise<string | null>,
): Promise<Record<string, string>> {
  const read = await Promise.all(
    Object.entries(produced).map(async ([name, value]) => {
      if (!BLOB_REF.test(value)) {
        return [name, value] as const;
      }
      const output = await readBlob(value);

      return output === null
        ? null
        : ([name, resultTextFromOutput(output).trim()] as const);
    }),
  );

  return Object.fromEntries(read.filter((entry) => entry !== null));
}

/** Records the run's episode once the wrapped station has done its part; an episode that cannot be written is logged, never a failed settlement. */
export function recordingRunEpisode(
  deps: RunEpisodeDeps,
  next: Handle,
): Handle {
  return async (brief, tools) => {
    const report = await next(brief, tools);
    const runId = brief.needs.run_id;

    await recordEpisode(deps, runId).catch((err: unknown) =>
      deps.warn(
        `[run-settled] no episode for run ${runId}: ${errorMessage(err)}`,
      ),
    );

    return report;
  };
}

async function recordEpisode(deps: RunEpisodeDeps, runId: string) {
  const run = await deps.run(runId);
  const episode = run && runEpisodeOf(run, await deps.agentReports(runId));

  await (episode && deps.post(episode));
}
