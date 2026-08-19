import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { AssemblyRunStartInput } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { repoFullName } from "../common-schemas.js";

/**
 * POST /api/assembly-runs — start one run of a blueprint.
 *
 * The seam a courier CronJob posts to (#1357): the schedule lives in Kubernetes,
 * the work lives in an assembly line, and the pod between them carries a message
 * and no business logic. Before this, `assemblyRuns.start()` was reachable only
 * in-process from the Floor, so anything that wanted to start a line had to BE
 * the Floor — which is how four batch jobs ended up living in the coordinator.
 *
 * The write is `start()`'s existing atomic CTE: the `pipeline.assembly_runs` row
 * and its `assembly_run.start` event land together, and the Floor's event loop
 * claims the event and walks the line exactly as it does for every other run.
 * Nothing here knows what the line does.
 */

const StartBody = z.object({
  /** Blueprint name, e.g. `memory-consolidation`. `blueprintName` on the wire
   *  would leak an internal spelling into a hand-written CronJob body. */
  definition: z.string().min(1).max(200),
  repo: repoFullName,
  branch: z.string().min(1).max(300).optional(),
  args: z.record(z.unknown()).optional(),
});

/** Declared so the generator emits 201 + `{ id }`. Without a contract it infers
 *  a bodyless 200, and web-ui's generated client types then describe a response
 *  the server never sends. */
const StartResponse = z.object({ id: z.string() });

type StartRun = (input: AssemblyRunStartInput) => Promise<string>;

const defaultStart: StartRun = async ({ blueprintName, repo, ...opts }) =>
  (await projectFor(repo)).assemblyRuns.start(blueprintName, opts);

export function startRunRoute(start: StartRun = defaultStart): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-runs",
    options: zodResponse(
      {
        ...bearerScope("task"),
        validate: { payload: zodValidate(StartBody) },
      },
      StartResponse,
      { name: "AssemblyRunStarted", status: 201, description: "Run started" },
    ),
    handler: async (request, h) => {
      const body = request.payload as z.infer<typeof StartBody>;
      const id = await start({
        blueprintName: body.definition,
        repo: body.repo,
        ...(body.branch === undefined ? {} : { branch: body.branch }),
        ...(body.args === undefined ? {} : { args: body.args }),
      });

      return h.response({ id }).code(201);
    },
  };
}
