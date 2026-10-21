// POST /api/assembly-runs/{id}/nodes/{node}/run — a person runs one station of a floor run again, open or finished: the floor reopens a finished run to take it.
import type { Pool } from "pg";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { LOOP_LINE } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import { ONBOARD_LINE } from "@re-cinq/lore-shared/onboard/floor-onboard.js";
import { startValueOf } from "@re-cinq/lore-shared/floor/run-start-items.js";
import {
  runNodeByHand,
  type FloorPatience,
  type HandStartFloor,
  type RunNodeAsk,
} from "../../../work/floor/run-node-by-hand.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";

/** The floor lines whose runs carry a `pipeline.tasks` row to revive. Mirrors `apps/stations/.../settle-task.ts`'s `TASK_LINES` — the two ends of the same task-status lifecycle. */
const TASK_LINES: readonly string[] = [LOOP_LINE, ONBOARD_LINE];

const RunNodeBody = z.object({ requested_by: z.string().min(1) });

const NodeRunAsked = z.object({ run_id: z.string(), pending: z.boolean() });

const RUN_NODE_OPTIONS = zodResponse(
  {
    ...bearerScope("task"),
    validate: { payload: zodValidate(RunNodeBody) },
  },
  NodeRunAsked,
  {
    name: "NodeRunAsked",
    status: 202,
    description:
      "The floor was asked to run the node again in its run, in the person's name; pending when it had not taken the ask within a few seconds. 400 for the line's exit or fail node or a node it does not have, 404 for a run the floor does not have, 409 with the floor's reason when it refused",
    errors: [400, 404, 409],
  },
);

export function runNodeRoute(
  getPool: () => Pool | null,
  floorOf: () => HandStartFloor = floorClient,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-runs/{id}/nodes/{node}/run",
    options: RUN_NODE_OPTIONS,
    handler: withPool(getPool, (pool, request, h) =>
      serveRunNode(floorOf, pool, request, h),
    ),
  };
}

async function serveRunNode(
  floorOf: () => HandStartFloor,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const { requested_by } = request.payload as z.infer<typeof RunNodeBody>;
  const asked = await handleRunNode(floorOf(), pool, {
    runId: request.params.id,
    nodeId: request.params.node,
    actor: requested_by,
  });

  return h.response(asked).code(202);
}

export async function handleRunNode(
  floor: HandStartFloor,
  pool: Pool,
  ask: RunNodeAsk,
  patience?: FloorPatience,
): Promise<z.infer<typeof NodeRunAsked>> {
  const { runId, pending } = await runNodeByHand(floor, ask, patience);

  await reviveTaskIfAny(floor, pool, runId);

  return { run_id: runId, pending };
}

/** A by-hand start never touches Postgres on its own (it only posts a floor event) — so a ticket's task would stay frozen at its old terminal status while the revived run is live, and the settle station's CAS (`setStatusIf(id, "running", ...)`) would silently no-op once it finishes. Flip it back to `running` here, for exactly the lines that carry a task. */
async function reviveTaskIfAny(
  floor: HandStartFloor,
  pool: Pool,
  runId: string,
): Promise<void> {
  const found = await floor.runs.get(runId);
  const run = found?.run;

  if (!run || !TASK_LINES.includes(run.lineId)) {
    return;
  }
  const taskId = startValueOf(run, "task_id");

  if (!taskId) {
    return;
  }
  await pool.query(
    `UPDATE pipeline.tasks SET status = 'running', updated_at = now() WHERE id = $1`,
    [taskId],
  );
}
