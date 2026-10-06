import type { FloorClient, RunView } from "@re-cinq/floor-client";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

/** The small Floor surface an upgrade needs: read the old run, find the current line, and start it with the old inputs. */
export type UpgradeRunFloor = Pick<FloorClient, "runs" | "lines">;

export type RunUpgrade = {
  available: boolean;
  latestHash: string | null;
};

export async function upgradeFor(
  floor: UpgradeRunFloor,
  runId: string,
): Promise<RunUpgrade> {
  const found = await floor.runs.get(runId);

  enforceTrue(found, apiError(404), `the floor has no run ${runId}`);
  const latest = await floor.lines.get(found.run.lineId);

  return {
    available: latest !== null && latest.hash !== found.run.lineHash,
    latestHash: latest?.hash ?? null,
  };
}

/** Starts the latest definition with the exact bag that began the old run. The Floor ignores inputs a newer line no longer needs and validates inputs it newly needs. */
export async function upgradeRun(
  floor: UpgradeRunFloor,
  runId: string,
): Promise<{ runId: string }> {
  const found = await floor.runs.get(runId);

  enforceTrue(found, apiError(404), `the floor has no run ${runId}`);
  const upgrade = await upgradeForRun(floor, found.run);
  enforceTrue(
    upgrade.latestHash,
    apiError(409),
    `the floor has no current line ${found.run.lineId}`,
  );
  enforceTrue(
    upgrade.available,
    apiError(409),
    "this run already uses the latest assembly line",
  );

  const started = await floor.lines.start(found.run.lineId, {
    repo: found.run.repo,
    startItems: found.run.startItems,
    lineHash: upgrade.latestHash,
  });

  return { runId: started.run.id };
}

async function upgradeForRun(
  floor: UpgradeRunFloor,
  run: RunView,
): Promise<RunUpgrade> {
  const latest = await floor.lines.get(run.lineId);

  return {
    available: latest !== null && latest.hash !== run.lineHash,
    latestHash: latest?.hash ?? null,
  };
}
