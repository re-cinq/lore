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
import { projectFor } from "../../outbound/project-boot.js";
import {
  runIssuesStation,
  type IssuesStationDeps,
} from "../../planning/file-issues/issues.js";
import { runVerifiedIssuesStation } from "./verified-issues.js";

export interface SpecTicketsIssuesDeps {
  /** The visit's own run, which the station input identifies itself by. */
  runOf(visitId: string): Promise<string | null>;
  project(repo: string): Promise<NonNullable<IssuesStationDeps["project"]>>;
}

const productionDeps: SpecTicketsIssuesDeps = {
  runOf: async (visitId) =>
    (await floorClient().stationRuns.get(visitId))?.runId ?? null,
  project: (repo) => projectFor(repo),
};

export function specTicketsIssuesHandle(deps: SpecTicketsIssuesDeps): Handle {
  return async (brief, tools) => {
    try {
      const verified = Boolean(brief.needs.verified_decomposition);
      const artifact = verified ? "verified_decomposition" : "decomposition";
      const decomposition = (await tools.read(artifact)).toString("utf8");
      const input = await stationInputOf(deps, brief, decomposition);
      const project = await deps.project(input.repo);

      return reportOf(
        await (verified
          ? verifiedIssues(input, project, tools)
          : legacyIssues(input, project)),
      );
    } catch (err) {
      const message = (err as Error).message;

      console.log(eventLine(`spec-tickets-issues failed: ${message}`));

      return { outcome: "failed", error: message };
    }
  };
}

function legacyIssues(
  input: StationInput,
  project: NonNullable<IssuesStationDeps["project"]>,
): Promise<NodeResult> {
  return runIssuesStation(input, {
    project,
    queue: input.params.queue !== "false",
  });
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
      queue: queueOf(needs.queue),
    },
  };
}

function queueOf(value: string | undefined): string {
  enforceTrue(
    value === undefined || ["true", "false"].includes(value),
    Error,
    "queue must be true or false",
  );

  return value ?? "true";
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
