// Adapts the floor's Brief into the StationInput runIssuesStation already reads (apps/stations/src/planning/file-issues/), unchanged — see specs/external-floor/spec.md FR8.7.

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { specPathOfPlan } from "@re-cinq/lore-shared/feature-planning/spec-plan-path.js";
import { projectFor } from "../../outbound/project-boot.js";
import { runIssuesStation, type IssuesStationDeps } from "./issues.js";

export interface FileIssuesDeps {
  /** The visit's own run, carried on as the spec-task group id — stable across a re-drive of the same run. */
  runOf(visitId: string): Promise<string | null>;
  project(repo: string): Promise<NonNullable<IssuesStationDeps["project"]>>;
  uiUrl?: string;
}

const productionDeps: FileIssuesDeps = {
  runOf: async (visitId) =>
    (await floorClient().stationRuns.get(visitId))?.runId ?? null,
  project: (repo) => projectFor(repo),
  uiUrl: process.env.LORE_UI_URL,
};

export function fileIssuesHandle(deps: FileIssuesDeps): Handle {
  return async (brief, tools) => {
    const { repo, branch } = parseGitRef(brief.needs.target);

    try {
      const input = await stationInputOf(deps, { repo, branch, brief, tools });
      const project = await deps.project(repo);
      const result = await runIssuesStation(input, {
        project,
        uiUrl: deps.uiUrl,
      });

      return reportOf(result);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

interface TargetBrief {
  repo: string;
  branch: string;
  brief: { visitId: string; needs: Record<string, string> };
  tools: Parameters<Handle>[1];
}

async function stationInputOf(
  deps: FileIssuesDeps,
  { repo, branch, brief, tools }: TargetBrief,
): Promise<StationInput> {
  const [decomposition, specPath, runId] = await Promise.all([
    textOf(tools, "decomposition"),
    specPathOf(brief.needs, tools),
    groupingRunOf(deps, brief.visitId),
  ]);

  return {
    assembly_run_id: runId,
    node_id: "issues",
    node_type: "issues",
    repo,
    branch,
    task_id: null,
    params: paramsOf(brief.needs, decomposition, specPath),
  };
}

// Serves runs started before #2502, whose line declares spec_plan rather than spec_path; can go once none remain.
async function specPathOf(
  needs: Record<string, string>,
  tools: Parameters<Handle>[1],
): Promise<string | undefined> {
  if (needs.spec_path || !needs.spec_plan) {
    return needs.spec_path;
  }

  return specPathOfPlan(await textOf(tools, "spec_plan"));
}

/** The run's id is the spec-tasks' group id, and the merge-check reads that group to flip the spec's status. A visit id would differ on every re-drive, so the tasks would land in a group nobody counts: better to fail here than to file them wrong. */
async function groupingRunOf(
  deps: FileIssuesDeps,
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

function paramsOf(
  needs: Record<string, string>,
  decomposition: string,
  specPath: string | undefined,
): Record<string, string> {
  return {
    feature_decomposition: decomposition,
    plan_id: needs.plan_id,
    ...(needs.plan_title ? { plan_title: needs.plan_title } : {}),
    ...(specPath ? { spec_path: specPath } : {}),
  };
}

function textOf(tools: Parameters<Handle>[1], need: string): Promise<string> {
  return tools.read(need).then((bytes) => bytes.toString("utf8"));
}

// Report has no generic extras channel, so a rework objection rides in `error`.
function reportOf(result: NodeResult): Report {
  if (result.outcome === "changes_requested") {
    return {
      outcome: "changes_requested",
      error: result.extras?.["Lore-Issues-Objection"],
    };
  }

  return { outcome: result.outcome };
}

export function startFileIssuesStation(): RunningStation {
  return defineStation("issues", fileIssuesHandle(productionDeps));
}
