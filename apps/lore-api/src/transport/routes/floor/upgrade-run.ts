import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import type { UpgradeRunFloor } from "../../../work/floor/upgrade-run.js";
import { upgradeFor, upgradeRun } from "../../../work/floor/upgrade-run.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

const UpgradeState = z.object({
  available: z.boolean(),
  latest_hash: z.string().nullable(),
});
const UpgradedRun = z.object({ run_id: z.string() });

export function upgradeRunRoutes(
  floorOf: () => UpgradeRunFloor = floorClient,
): ServerRoute[] {
  return [
    {
      method: "GET",
      path: "/api/assembly-runs/{id}/upgrade",
      options: zodResponse(bearerScope("read"), UpgradeState, {
        name: "AssemblyRunUpgrade",
        description: "Whether a newer assembly line version is available",
      }),
      handler: async (request) => upgradeState(floorOf(), request),
    },
    {
      method: "POST",
      path: "/api/assembly-runs/{id}/upgrade",
      options: zodResponse(bearerScope("task"), UpgradedRun, {
        name: "AssemblyRunUpgraded",
        status: 201,
        description:
          "A new run on the latest assembly line, retaining the source inputs",
        errors: [404, 409],
      }),
      handler: async (request, h) =>
        h.response(await upgrade(runFloor(floorOf), request)).code(201),
    },
  ];
}

async function upgradeState(floor: UpgradeRunFloor, request: Request) {
  const state = await upgradeFor(floor, request.params.id);
  return { available: state.available, latest_hash: state.latestHash };
}

async function upgrade(floor: UpgradeRunFloor, request: Request) {
  const started = await upgradeRun(floor, request.params.id);
  return { run_id: started.runId };
}

function runFloor(floorOf: () => UpgradeRunFloor): UpgradeRunFloor {
  return floorOf();
}
