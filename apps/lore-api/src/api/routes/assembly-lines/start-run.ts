import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { AssemblyRunStartInput } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  definitionHash,
  loadBuiltinAssemblyLines,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { projectFor } from "../../../platform/project-boot.js";
import { apiError, rethrowBoom } from "../../../server/api-error.js";
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

const StartBody = z
  .object({
    /** Blueprint name, e.g. `memory-consolidation`. `blueprintName` on the wire
     *  would leak an internal spelling into a hand-written CronJob body. */
    definition: z.string().min(1).max(200),
    repo: repoFullName,
    branch: z.string().min(1).max(300).optional(),
    args: z.record(z.unknown()).optional(),
    /** Fork-and-rerun (specs/fork-rerun-from-node): copy the source run's rows
     *  through `node_id`'s latest completed visit and let the walk resume at its
     *  successor. `run_id`/`node_id` on the wire for the same reason `definition`
     *  is not `blueprintName`. */
    resume_from: z
      .object({
        run_id: z.string().min(1).max(200),
        node_id: z.string().min(1).max(200),
        /** Fork from exactly this visit of `node_id` (loop-exact: on a line with
         *  back-edges the node's LATEST row can postdate the retry target).
         *  Omitted, the latest completed visit is the cutoff. */
        iteration: z.number().int().min(1).optional(),
      })
      .optional(),
  })
  .refine(
    (body) => body.resume_from === undefined || body.branch === undefined,
    {
      message:
        "branch cannot ride alongside resume_from — a fork inherits the source run's branch",
    },
  );

/** Declared so the generator emits 201 + `{ id }`. Without a contract it infers
 *  a bodyless 200, and web-ui's generated client types then describe a response
 *  the server never sends. */
const StartResponse = z.object({ id: z.string() });

type StartRun = (input: AssemblyRunStartInput) => Promise<string>;
type LoadDefinitions = () => Promise<ReadonlyMap<string, AssemblyLine>>;

const defaultStart: StartRun = async ({ blueprintName, repo, ...opts }) =>
  (await projectFor(repo)).assemblyRuns.start(blueprintName, opts);

export function startRunRoute(
  start: StartRun = defaultStart,
  loadDefinitions: LoadDefinitions = loadBuiltinAssemblyLines,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-runs",
    options: zodResponse(
      {
        ...bearerScope("task"),
        validate: { payload: zodValidate(StartBody) },
      },
      StartResponse,
      {
        name: "AssemblyRunStarted",
        status: 201,
        description: "Run started",
        errors: [400, 409],
      },
    ),
    handler: async (request, h) => {
      const body = request.payload as z.infer<typeof StartBody>;
      const input: AssemblyRunStartInput = {
        blueprintName: body.definition,
        repo: body.repo,
        ...(body.branch === undefined ? {} : { branch: body.branch }),
        ...(body.args === undefined ? {} : { args: body.args }),
      };

      if (body.resume_from === undefined) {
        return h.response({ id: await start(input) }).code(201);
      }

      // The fork's drift guard needs the CURRENT definition's hash as its
      // left-hand side, and this route is where the definition loads —
      // `libs/shared` cannot derive it (the dependency runs the other way).
      const definition = (await loadDefinitions()).get(body.definition);

      enforceTrue(
        definition,
        apiError(400),
        `unknown definition "${body.definition}"`,
      );

      try {
        const id = await start({
          ...input,
          blueprintHash: definitionHash(definition),
          resumeFrom: {
            lineId: body.resume_from.run_id,
            nodeId: body.resume_from.node_id,
            ...(body.resume_from.iteration === undefined
              ? {}
              : { iteration: body.resume_from.iteration }),
          },
        });

        return h.response({ id }).code(201);
      } catch (err) {
        rethrowBoom(err);
        // The port validates the fork BEFORE writing anything, so a throw here
        // is a refusal (drift, non-terminal source, missing visit) the caller
        // must hear — not an internal failure to hide behind a 500.
        throw apiError(409)(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
