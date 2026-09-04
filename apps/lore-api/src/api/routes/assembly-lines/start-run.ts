import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { AssemblyRunStartInput } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { ResumeRefusedError } from "@re-cinq/lore-shared/project/assembly-runs/resume.js";
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

// POST /api/assembly-runs — the seam a courier CronJob posts to (#1357), since assemblyRuns.start() was previously reachable only in-process from the Floor; uses start()'s existing atomic CTE, so nothing here knows what the line does.

const StartBody = z
  .object({
    // Blueprint name; `blueprintName` on the wire would leak an internal spelling into a hand-written CronJob body.
    definition: z.string().min(1).max(200),
    repo: repoFullName,
    branch: z.string().min(1).max(300).optional(),
    args: z.record(z.unknown()).optional(),
    // Fork-and-rerun (specs/fork-rerun-from-node): copy the source run's rows through node_id's latest completed visit and resume at its successor.
    resume_from: z
      .object({
        run_id: z.string().min(1).max(200),
        node_id: z.string().min(1).max(200),
        // Fork from exactly this visit of node_id (loop-exact — a back-edge line's LATEST row can postdate the retry target); omitted defaults to the latest completed visit.
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

// Declared so the generator emits 201 + { id }; without it, generated client types describe a response the server never sends.
const StartResponse = z.object({ id: z.string() });

type StartRun = (input: AssemblyRunStartInput) => Promise<string>;
type LoadDefinitions = () => Promise<ReadonlyMap<string, AssemblyLine>>;

const defaultStart: StartRun = async ({ blueprintName, repo, ...opts }) =>
  (await projectFor(repo)).assemblyRuns.start(blueprintName, opts);

function buildStartInput(
  body: z.infer<typeof StartBody>,
): AssemblyRunStartInput {
  return {
    blueprintName: body.definition,
    repo: body.repo,
    ...(body.branch === undefined ? {} : { branch: body.branch }),
    ...(body.args === undefined ? {} : { args: body.args }),
  };
}

// The fork's drift guard needs the CURRENT definition's hash as its left-hand side; libs/shared can't derive it (the dependency runs the other way).
async function startResumedRun(
  body: z.infer<typeof StartBody>,
  input: AssemblyRunStartInput,
  start: StartRun,
  loadDefinitions: LoadDefinitions,
): Promise<string> {
  const resumeFrom = body.resume_from as NonNullable<typeof body.resume_from>;
  const definition = (await loadDefinitions()).get(body.definition);

  enforceTrue(
    definition,
    apiError(400),
    `unknown definition "${body.definition}"`,
  );

  try {
    return await start({
      ...input,
      blueprintHash: definitionHash(definition),
      resumeFrom: {
        lineId: resumeFrom.run_id,
        nodeId: resumeFrom.node_id,
        ...(resumeFrom.iteration === undefined
          ? {}
          : { iteration: resumeFrom.iteration }),
      },
    });
  } catch (err) {
    rethrowBoom(err);

    // Only the port's typed REFUSALS (drift, non-terminal source, missing visit — all pre-write) become a 409; anything else stays the internal failure it is.
    if (err instanceof ResumeRefusedError) {
      throw apiError(409)(err.message);
    }

    throw err;
  }
}

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
      const input = buildStartInput(body);

      if (body.resume_from === undefined) {
        return h.response({ id: await start(input) }).code(201);
      }

      const id = await startResumedRun(body, input, start, loadDefinitions);

      return h.response({ id }).code(201);
    },
  };
}
