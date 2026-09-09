/** Artifact replay for a planning round whose agent succeeded but whose result delivery was lost (#1298): the round's own transcript is re-read and the GapResult it already produced is applied. The reaper decides WHEN; this file is HOW. */

import { pipeline } from "../../outbound/queues.js";
import type { projectFor } from "../../outbound/project-boot.js";
import type { FeatureWithIterations } from "@re-cinq/lore-shared/project/features/features-port.js";
import { applyGapResult } from "@re-cinq/lore-shared/feature-planning/apply-gap-result.js";
import { gapResultFromTurns } from "@re-cinq/lore-shared/feature-planning/recover-gap-result.js";
import {
  decideArtifactRecovery,
  type ArtifactRecoveryInput,
} from "./planning-artifact-recovery.js";
import { isPlanningPhase } from "@re-cinq/lore-shared/feature-planning/gap-result.js";

type Project = Awaited<ReturnType<typeof projectFor>>;

/** How many transcript turns one recovery scan will page through before giving up — a runaway bound, not a tuning knob. */
const RECOVERY_TURN_PAGE = 200;
const RECOVERY_TURN_PAGES_MAX = 25;

/** The round + run pair eligible for artifact recovery (#1298): a recent round with no result whose task ran on an assembly run, while the feature is still mid-planning; null otherwise. */
export function lostArtifactRound(
  latest: FeatureWithIterations["iterations"][number] | undefined,
  latestRun: { id: string } | undefined,
  featureStatus: string,
): { round: { iteration: number }; runId: string } | null {
  if (!latest || !latestRun || latest.gap_result) {
    return null;
  }

  if (!["failed", "running"].includes(latest.status)) {
    return null;
  }

  return isPlanningPhase(featureStatus)
    ? { round: latest, runId: latestRun.id }
    : null;
}

/** Run decideArtifactRecovery for a lost round and, when it says recover, re-apply the artifact from the run transcript. */
export async function recoverLostRound(
  project: Project,
  featureId: string,
  lostRound: NonNullable<ReturnType<typeof lostArtifactRound>>,
  run: Omit<ArtifactRecoveryInput, "nodes">,
): Promise<boolean> {
  const stationRuns = await pipeline().assemblyRuns.listStationRuns(
    lostRound.runId,
  );
  const decision = decideArtifactRecovery({ nodes: stationRuns, ...run });

  if (decision.kind !== "recover") {
    return false;
  }

  return recoverArtifact(project, featureId, lostRound.round, {
    runId: lostRound.runId,
    agentCrName: decision.agentCrName,
  });
}

async function recoverArtifact(
  project: Project,
  featureId: string,
  latest: { iteration: number },
  { runId, agentCrName }: { runId: string; agentCrName: string | null },
): Promise<boolean> {
  const payload = await readGapResult(runId, agentCrName);

  if (payload === null) {
    return false;
  }

  const applied = await applyGapResult(
    project.features,
    featureId,
    latest.iteration,
    payload,
  );

  return applied.outcome === "ready";
}

/** Re-apply a lost round result from the run transcript (#1298): the terminal `Write` of `result.json` holds the full GapResult; null when none was produced. */
async function readGapResult(
  runId: string,
  agentCrName: string | null,
): Promise<ReturnType<typeof gapResultFromTurns>> {
  return gapResultFromTurns(
    await readRunEnvelopes(runId, agentCrName),
    "result.json",
  );
}

/** The run's transcript envelopes, paged and CAPPED: recovery reads a whole run, and an unbounded walk over a long one would hold every turn in memory to find one artifact. */
async function readRunEnvelopes(
  runId: string,
  agentCrName: string | null,
): Promise<unknown[]> {
  const envelopes: unknown[] = [];
  let cursor = "0";

  for (let page = 0; page < RECOVERY_TURN_PAGES_MAX; page++) {
    const turns = await readTurnPage(runId, cursor);

    if (turns.length === 0) {
      break;
    }
    envelopes.push(...envelopesOf(turns, agentCrName));
    cursor = turns[turns.length - 1].id;
  }

  return envelopes;
}

/** One page of a run's turns, oldest first from the cursor; an empty page means the walk is done. */
async function readTurnPage(runId: string, cursor: string) {
  return pipeline().agentRunTurns.listByLine(runId, cursor, RECOVERY_TURN_PAGE);
}

/** Filtered by CR name when there is one, because a run may hold turns from more than one attempt and an unscoped replay would apply a previous round's result (#1302). */
function envelopesOf(
  turns: Awaited<ReturnType<typeof readTurnPage>>,
  agentCrName: string | null,
): unknown[] {
  return turns
    .filter((turn) => agentCrName === null || turn.agentCrName === agentCrName)
    .map((turn) => turn.envelope);
}
