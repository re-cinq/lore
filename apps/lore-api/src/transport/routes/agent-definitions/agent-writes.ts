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

/** A bad body and a refused ceremony are both ANSWERS, not exceptions — each carries its own status, so only an unexpected failure reaches the route's catch. */

export async function createAgentDefinition(
  pool: Pool,
  request: Request,
  repo: string,
): Promise<{ code: number; body: object }> {
  const project = await projectFor(repo);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hapi types omit it, but request.payload is genuinely null for an empty body.
  const body = request.payload ?? {};
  let create: ReturnType<typeof parseAgentInput>;

  try {
    create = parseAgentInput(body);
  } catch (err) {
    return {
      code: 400,
      body: { error: "invalid_agent", issues: issuesOf(err) },
    };
  }

  const { gate, ceremony } = await resolveCeremony(
    request,
    repo,
    imageFieldTouched(create),
  );

  if (gate && !gate.ok) {
    return { code: gate.code, body: gate.body };
  }
  const def = await writeNewDefinition(project, create);

  await audit(pool, repo, "agent_created", { name: def.name, ceremony });

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

/** Same shape as the create path: a bad patch and a refused ceremony are answers with their own status, not exceptions. */

export async function updateAgentDefinition(
  pool: Pool,
  request: Request,
  target: { repo: string; name: string },
): Promise<{ code: number; body: object }> {
  const { repo, name } = target;
  const project = await projectFor(repo);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hapi types omit it, but request.payload is genuinely null for an empty body.
  const body = request.payload ?? {};
  let patch: ReturnType<typeof parseAgentPatch>;

  try {
    patch = parseAgentPatch(body);
  } catch (err) {
    return {
      code: 400,
      body: { error: "invalid_agent", issues: issuesOf(err) },
    };
  }

  const { gate, ceremony } = await resolveCeremony(
    request,
    repo,
    imageFieldTouched(patch),
  );

  if (gate && !gate.ok) {
    return { code: gate.code, body: gate.body };
  }

  const def = await writePatchedDefinition(project, name, patch);

  await audit(pool, repo, "agent_updated", { name, ceremony });

  return { code: 200, body: { ok: true, agent: def, ceremony } };
}
