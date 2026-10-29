import {
  defineStation,
  type Brief,
  type Tools,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { parseDecomposition } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import {
  assessImplementation,
  type ImplementationAssessment,
} from "@re-cinq/lore-shared/spec-tickets/implementation-assessment.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  coverageDeps,
  type CoverageDeps,
} from "../../planning/coverage-deps.js";

export function verifyImplementationHandle(deps: CoverageDeps): Handle {
  return async (brief, tools) => {
    try {
      const assessment = await assessVisit(deps, brief, tools);

      return await reportAssessment(deps, brief, tools, assessment);
    } catch (error) {
      return { outcome: "failed", error: (error as Error).message };
    }
  };
}

async function assessVisit(
  deps: CoverageDeps,
  { needs }: Brief,
  tools: Tools,
): Promise<ImplementationAssessment> {
  const { repo } = parseGitRef(needs.target);
  const commit = needs.merge_sha;

  enforceTrue(commit, Error, "merge_sha is required");
  const spec = await deps.readSpec(repo, needs.spec_path, commit);

  const message = `spec ${needs.spec_path} does not exist at ${commit}`;

  enforceTrue(spec !== null, Error, message);
  const raw = (await tools.read("decomposition")).toString("utf8");
  const decomposition = parseDecomposition(parseModelJson(raw));

  return assessImplementation(decomposition, {
    spec,
    specPath: needs.spec_path,
    commit,
    read: (path) => deps.readSpec(repo, path, commit),
  });
}

async function reportAssessment(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
  assessment: ImplementationAssessment,
): Promise<Report> {
  await publishReport(tools, brief.needs.merge_sha, assessment);

  if (assessment.objections.length > 0) {
    return rejectedAssessment(deps, brief.visitId, assessment.objections);
  }
  await tools.produce(
    "verified_decomposition",
    JSON.stringify(assessment.decomposition),
  );

  return { outcome: "success" };
}

async function publishReport(
  tools: Tools,
  commit: string,
  assessment: ImplementationAssessment,
): Promise<void> {
  const lines = [
    "## Implementation verification",
    `Commit: ${commit}`,
    ...assessment.objections,
    ...assessment.diagnostics,
  ];

  await tools.produce("implementation_report", lines.join("\n\n"));
}

async function rejectedAssessment(
  deps: CoverageDeps,
  visitId: string,
  objections: string[],
): Promise<Report> {
  const visits = await deps.visitsOf(visitId);
  const spent = visits.filter(
    (visit) =>
      visit.nodeId === "verify-implementation" &&
      visit.report?.outcome === "changes_requested",
  ).length;

  return {
    outcome: spent < 3 ? "changes_requested" : "failed",
    error: objections.join("\n"),
  };
}

export function startVerifyImplementationStation(): RunningStation {
  return defineStation(
    "spec-tickets-verify",
    verifyImplementationHandle(coverageDeps),
  );
}
