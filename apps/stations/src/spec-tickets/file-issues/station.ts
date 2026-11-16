// Files a merged spec's decomposition as a story and task issues, through the planning line's filing (../../planning/file-issues/issues.ts). The spec's filing key stands where a plan id does, so a later merge of the same spec rewrites the issues this one filed.
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
import { specFilingKey } from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";
import { parseDecomposition } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { specFilesOfRun } from "@re-cinq/lore-shared/feature-planning/spec-plan-path.js";
import { specHeading } from "@re-cinq/lore-shared";
import { projectFor } from "../../outbound/project-boot.js";
import { requestPlan } from "../../planning/plan-api.js";
import {
  runIssuesStation,
  type IssuesStationDeps,
} from "../../planning/file-issues/issues.js";
import { runVerifiedIssuesStation } from "./verified-issues.js";

export interface SpecTicketsIssuesDeps {
  /** The visit's own run, which the station input identifies itself by. */
  runOf(visitId: string): Promise<string | null>;
  project(repo: string): Promise<NonNullable<IssuesStationDeps["project"]>>;
  /** Saves the story issue on the plan the spec came from; lore-api keeps it only when it differs from the plan's own. */
  savePlanStory(planId: string, issueNumber: number): Promise<void>;
}

const productionDeps: SpecTicketsIssuesDeps = {
  runOf: async (visitId) =>
    (await floorClient().stationRuns.get(visitId))?.runId ?? null,
  project: (repo) => projectFor(repo),
  savePlanStory: async (planId, issueNumber) => {
    await requestPlan(`${planId}/story`, {
      method: "POST",
      body: { issueNumber, setBy: "spec-tickets" },
    });
  },
};

export function specTicketsIssuesHandle(deps: SpecTicketsIssuesDeps): Handle {
  return async (brief, tools) => {
    try {
      const verified = Boolean(brief.needs.verified_decomposition);
      const artifact = verified ? "verified_decomposition" : "decomposition";
      const decomposition = (await tools.read(artifact)).toString("utf8");
      const { input, project } = await filingOf(deps, brief, decomposition);

      const result = await (verified
        ? verifiedIssues(input, project, tools)
        : runIssuesStation(input, { project }));

      await saveStoryOnSourcePlan(deps, brief.needs.source_plan_id, result);

      return reportOf(result);
    } catch (err) {
      const message = (err as Error).message;

      console.log(eventLine(`spec-tickets-issues failed: ${message}`));

      return { outcome: "failed", error: message };
    }
  };
}

async function saveStoryOnSourcePlan(
  deps: SpecTicketsIssuesDeps,
  sourcePlanId: string | undefined,
  result: NodeResult,
): Promise<void> {
  const storyIssue = result.extras?.["Lore-Story-Issue"];

  if (!sourcePlanId || !storyIssue) {
    return;
  }
  await deps.savePlanStory(sourcePlanId, Number(storyIssue));
}

async function filingOf(
  deps: SpecTicketsIssuesDeps,
  brief: Brief,
  decomposition: string,
) {
  const unnamed = await stationInputOf(deps, brief, decomposition);
  const project = await deps.project(unnamed.repo);

  return { project, input: await titledAfterSpec(unnamed, project) };
}

/** A spec's story takes the spec's name, not its first slice's: a slice's name can change from run to run, and many specs share "Setup and foundation". */
async function titledAfterSpec(
  input: StationInput,
  project: NonNullable<IssuesStationDeps["project"]>,
): Promise<StationInput> {
  const { feature_decomposition: raw, spec_path: specPath } = input.params;
  const [file] = specFilesOfRun(specPath, undefined);
  const ref =
    parseDecomposition(parseModelJson(raw)).spec_commit ?? input.branch;
  const [spec, planMd] = await readSpecAndPlan(project, file, ref);

  return {
    ...input,
    params: {
      ...input.params,
      plan_title: specHeading(spec ?? "") ?? file,
      ...(planMd ? { plan_md: planMd } : {}),
    },
  };
}

async function readSpecAndPlan(
  project: NonNullable<IssuesStationDeps["project"]>,
  specFile: string,
  ref: string,
): Promise<[string | null, string | null]> {
  return Promise.all([
    project.repo.read(specFile, ref),
    project.repo.read(specFile.replace(/spec\.md$/, "plan.md"), ref),
  ]);
}

async function verifiedIssues(
  input: StationInput,
  project: NonNullable<IssuesStationDeps["project"]>,
  tools: Tools,
): Promise<NodeResult> {
  const result = await runVerifiedIssuesStation(input, project);

  await tools.produce(
    "ticketing_result",
    JSON.stringify({ outcome: result.outcome, ...result.extras }),
  );

  return result;
}

async function stationInputOf(
  deps: SpecTicketsIssuesDeps,
  { visitId, needs }: Brief,
  decomposition: string,
): Promise<StationInput> {
  return {
    assembly_run_id: await runIdOf(deps, visitId),
    node_id: "issues",
    node_type: "spec-tickets-issues",
    ...parseGitRef(needs.target),
    task_id: null,
    params: {
      feature_decomposition: decomposition,
      filing_key: specFilingKey(needs.spec_path),
      spec_path: needs.spec_path,
    },
  };
}

async function runIdOf(
  deps: SpecTicketsIssuesDeps,
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
export function reportOf(result: NodeResult): Report {
  return result.outcome === "changes_requested"
    ? {
        outcome: "changes_requested",
        error: result.extras?.["Lore-Issues-Objection"],
      }
    : { outcome: result.outcome };
}

export function startSpecTicketsIssuesStation(): RunningStation {
  return defineStation(
    "spec-tickets-issues",
    specTicketsIssuesHandle(productionDeps),
  );
}
