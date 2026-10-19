import type { FloorClient, RunView } from "@re-cinq/floor-client";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

/** The small Floor surface an upgrade needs: read the old run, find the current line, cancel the old run and start the new one. */
export type UpgradeRunFloor = Pick<FloorClient, "runs" | "lines">;

export type RunUpgrade = {
  available: boolean;
  latestHash: string | null;
};

const UPGRADED = "upgraded to the latest assembly line";

export async function upgradeFor(
  floor: UpgradeRunFloor,
  runId: string,
): Promise<RunUpgrade> {
  return latestUpgrade(floor, await sourceRun(floor, runId));
}

/** Starts the latest definition with the exact bag that began the old run. The Floor ignores inputs a newer line no longer needs and validates inputs it newly needs. */
export async function upgradeRun(
  floor: UpgradeRunFloor,
  runId: string,
): Promise<{ runId: string }> {
  const run = await sourceRun(floor, runId);
  const upgrade = await latestUpgrade(floor, run);

  enforceTrue(
    upgrade.latestHash,
    apiError(409),
    `the floor has no current line ${run.lineId}`,
  );
  enforceTrue(
    upgrade.available,
    apiError(409),
    "this run already uses the latest assembly line",
  );

  return restart(floor, run, upgrade.latestHash);
}

/** The floor answers a start on a subject that already has an open run by joining that run, so the old run is cancelled first — otherwise the upgrade would hand back the old run on the old version. A join it still answers with is an upgrade someone already made: that run is the answer when it is on the version asked for, and a refusal when it is not. */
async function restart(
  floor: UpgradeRunFloor,
  run: RunView,
  lineHash: string,
): Promise<{ runId: string }> {
  if (run.finishedAt === null) {
    await floor.runs.cancel(run.id, UPGRADED);
  }
  const started = await floor.lines.start(run.lineId, {
    repo: run.repo ?? undefined,
    startItems: run.startItems,
    lineHash,
  });

  enforceTrue(
    !started.joined || started.run.lineHash === lineHash,
    apiError(409),
    `the floor joined the open run ${started.run.id}, which is not on the latest assembly line`,
  );

  return { runId: started.run.id };
}

async function sourceRun(
  floor: UpgradeRunFloor,
  runId: string,
): Promise<RunView> {
  const found = await floor.runs.get(runId);

  enforceTrue(found, apiError(404), `the floor has no run ${runId}`);

  return found.run;
}

async function latestUpgrade(
  floor: UpgradeRunFloor,
  run: RunView,
): Promise<RunUpgrade> {
  const latest = await floor.lines.get(run.lineId);

  return {
    available: latest !== null && latest.hash !== run.lineHash,
    latestHash: latest?.hash ?? null,
  };
}
