// Files a large triaged issue's decomposition as a story and task issues, through the planning line's filing (../../planning/file-issues/issues.ts), but unqueued: the task issues get `triage: needs-priority` instead of a priority, so nothing reaches the implementation loop until a person picks one (specs/issue-triage FR33).

import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { eventLine, type NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { projectFor } from "../../outbound/project-boot.js";
import {
  runIssuesStation,
  type IssuesStationDeps,
} from "../../planning/file-issues/issues.js";

const TRIAGE_NODE = { node_id: "file-issues", node_type: "triage-file-issues" };

export interface TriageFileIssuesDeps {
  /** The visit's own run, which the station input identifies itself by. */
  runOf(visitId: string): Promise<string | null>;
  project(repo: string): Promise<NonNullable<IssuesStationDeps["project"]>>;
}

const productionDeps: TriageFileIssuesDeps = {
  runOf: async (visitId) =>
    (await floorClient().stationRuns.get(visitId))?.runId ?? null,
  project: (repo) => projectFor(repo),
};

export function triageFileIssuesHandle(deps: TriageFileIssuesDeps): Handle {
  return async (brief, tools) => {
    try {
      const input = await stationInputOf(deps, brief, tools);
      const project = await deps.project(input.repo);

      return reportOf(await runIssuesStation(input, { project, queue: false }));
    } catch (err) {
      const message = (err as Error).message;

      console.log(eventLine(`triage-file-issues failed: ${message}`));

      return { outcome: "failed", error: message };
    }
  };
}

async function stationInputOf(
  deps: TriageFileIssuesDeps,
  { visitId, needs }: Brief,
  tools: Tools,
): Promise<StationInput> {
  const [runId, decomposition] = await Promise.all([
    runIdOf(deps, visitId),
    tools.read("decomposition").then((bytes) => bytes.toString("utf8")),
  ]);

  return {
    assembly_run_id: runId,
    ...TRIAGE_NODE,
    ...parseGitRef(needs.target),
    task_id: null,
    params: {
      feature_decomposition: decomposition,
      filing_key: `triage-${needs.issue_number}`,
    },
  };
}

async function runIdOf(
  deps: TriageFileIssuesDeps,
  visitId: string,
): Promise<string> {
  const runId = await deps.runOf(visitId);

  enforceTrue(
    runId,
    Error,
    `the floor does not name the run of visit ${visitId}`,
  );

  return runId;
}

// Report has no generic extras channel, so a rework objection rides in `error`.
function reportOf(result: NodeResult): Report {
  return result.outcome === "changes_requested"
    ? {
        outcome: "changes_requested",
        error: result.extras?.["Lore-Issues-Objection"],
      }
    : { outcome: result.outcome };
}

export function startTriageFileIssuesStation(): RunningStation {
  return defineStation(
    "triage-file-issues",
    triageFileIssuesHandle(productionDeps),
  );
}
