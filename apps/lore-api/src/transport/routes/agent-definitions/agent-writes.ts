// Creating and updating an agent definition: the half that carries the two-key ceremony and the pod-resource merge. Separate from agents.ts, which owns the routes and the reads.

import {
  resolveCeremony,
  createFieldsWithPodResources,
  resolvePodResourcesUpdate,
  issuesOf,
  audit,
} from "./agent-common.js";
import type { Request } from "@hapi/hapi";
import type { Pool } from "pg";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  parseAgentInput,
  parseAgentPatch,
  imageFieldTouched,
} from "../../../work/agents/agents-schema.js";

type WriteOutcome = { code: number; body: object };

type Ceremony = Awaited<ReturnType<typeof resolveCeremony>>["ceremony"];

/** A bad body and a refused ceremony are both ANSWERS, not exceptions — each carries its own status, so only an unexpected failure reaches the route's catch. */
export async function createAgentDefinition(
  pool: Pool,
  request: Request,
  repo: string,
): Promise<WriteOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hapi types omit it, but request.payload is genuinely null for an empty body.
  const parsed = parsedOrInvalid(() => parseAgentInput(request.payload ?? {}));

  if (!parsed.ok) {
    return parsed.failure;
  }

  const create = parsed.value;
  const { gate, ceremony } = await resolveCeremony({
    request,
    repo,
    imageTouched: imageFieldTouched(create),
  });

  if (gate && !gate.ok) {
    return { code: gate.code, body: gate.body };
  }

  return createdOutcome(pool, repo, create, ceremony);
}

/** Same shape as the create path: a bad patch and a refused ceremony are answers with their own status, not exceptions. */
export async function updateAgentDefinition(
  pool: Pool,
  request: Request,
  target: { repo: string; name: string },
): Promise<WriteOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hapi types omit it, but request.payload is genuinely null for an empty body.
  const parsed = parsedOrInvalid(() => parseAgentPatch(request.payload ?? {}));

  if (!parsed.ok) {
    return parsed.failure;
  }

  const { repo } = target;
  const { gate, ceremony } = await resolveCeremony({
    request,
    repo,
    imageTouched: imageFieldTouched(parsed.value),
  });

  if (gate && !gate.ok) {
    return { code: gate.code, body: gate.body };
  }

  return updatedOutcome(pool, target, parsed.value, ceremony);
}

/** A malformed body is the CALLER's mistake: it answers 400 with the parse issues rather than raising. */
function parsedOrInvalid<T>(
  parse: () => T,
): { ok: true; value: T } | { ok: false; failure: WriteOutcome } {
  try {
    return { ok: true, value: parse() };
  } catch (err) {
    const body = { error: "invalid_agent", issues: issuesOf(err) };

    return { ok: false, failure: { code: 400, body } };
  }
}

/** Writes the row and records the ceremony that authorized it. */
async function createdOutcome(
  pool: Pool,
  repo: string,
  create: ReturnType<typeof parseAgentInput>,
  ceremony: Ceremony,
): Promise<WriteOutcome> {
  const project = await projectFor(repo);
  const def = await writeNewDefinition(project, create);

  await audit(pool, repo, "agent_created", { name: def.name, ceremony });

  return { code: 200, body: { ok: true, agent: def, ceremony } };
}

/** Creates the row. `pod_resources` is separated out because it MERGES onto the catalog defaults rather than replacing them — a definition that sets only a memory limit must not lose the CPU request that came with its image. */
async function writeNewDefinition(
  project: Awaited<ReturnType<typeof projectFor>>,
  create: ReturnType<typeof parseAgentInput>,
) {
  const { pod_resources, ...fields } = create;

  return project.agentDefs.create(
    await createFieldsWithPodResources(
      project.agentDefs,
      fields,
      pod_resources,
    ),
  );
}

/** Applies the patch and records the ceremony that authorized it. */
async function updatedOutcome(
  pool: Pool,
  target: { repo: string; name: string },
  patch: ReturnType<typeof parseAgentPatch>,
  ceremony: Ceremony,
): Promise<WriteOutcome> {
  const { repo, name } = target;
  const project = await projectFor(repo);
  const def = await writePatchedDefinition(project, name, patch);

  await audit(pool, repo, "agent_updated", { name, ceremony });

  return { code: 200, body: { ok: true, agent: def, ceremony } };
}

/** Applies the patch. `pod_resources` is resolved per key against what the definition already has, so a patch that names one limit does not clear the rest.  */
async function writePatchedDefinition(
  project: Awaited<ReturnType<typeof projectFor>>,
  name: string,
  patch: ReturnType<typeof parseAgentPatch>,
) {
  const { pod_resources, ...fields } = patch;

  return project.agentDefs.update(
    name,
    fields,
    await resolvePodResourcesUpdate(project.agentDefs, name, pod_resources),
  );
}
