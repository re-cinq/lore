// GET/POST /api/assembly-runs/{id}/upgrade — whether a newer version of the run's assembly line exists, and the new run started on it.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import type { UpgradeRunFloor } from "../../../work/floor/upgrade-run.js";
import { upgradeFor, upgradeRun } from "../../../work/floor/upgrade-run.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

const UpgradeState = z.object({ available: z.boolean() });

const UpgradedRun = z.object({ run_id: z.string() });

const UPGRADE_STATE_OPTIONS = zodResponse(bearerScope("read"), UpgradeState, {
  name: "AssemblyRunUpgrade",
  description:
    "Whether a newer version of the run's assembly line is available. 404 for a run the floor does not have",
  errors: [404],
});

const UPGRADE_RUN_OPTIONS = zodResponse(bearerScope("task"), UpgradedRun, {
  name: "AssemblyRunUpgraded",
  status: 201,
  description:
    "A new run on the latest version of the assembly line, retaining the source run's inputs; the source run is cancelled when it is still open. 404 for a run the floor does not have, 409 for a run already on the latest version",
  errors: [404, 409],
});

export function upgradeStateRoute(
  floorOf: () => UpgradeRunFloor = floorClient,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/upgrade",
    options: UPGRADE_STATE_OPTIONS,
    handler: async (request) => upgradeState(floorOf(), request),
  };
}

export function upgradeRunRoute(
  floorOf: () => UpgradeRunFloor = floorClient,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-runs/{id}/upgrade",
    options: UPGRADE_RUN_OPTIONS,
    handler: (request, h) => serveUpgrade(floorOf(), request, h),
  };
}

async function upgradeState(floor: UpgradeRunFloor, request: Request) {
  const state = await upgradeFor(floor, request.params.id);

  return { available: state.available };
}

async function serveUpgrade(
  floor: UpgradeRunFloor,
  request: Request,
  h: ResponseToolkit,
) {
  const started = await upgradeRun(floor, request.params.id);

  return h.response({ run_id: started.runId }).code(201);
}
