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
import {
  PgClusterAgents,
  ClusterAgent,
} from "@re-cinq/lore-shared/outbound/project/cluster-agents/cluster-agents-pg.js";

type WriteOutcome = { code: number; body: object };
type Ceremony = Awaited<ReturnType<typeof resolveCeremony>>["ceremony"];

export async function createAgentDefinition(
  pool: Pool,
  request: Request,
  repo: string,
): Promise<WriteOutcome> {
  return performAgentWrite({
    pool,
    request,
    repo,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- genuinely null on empty body
    parseFunc: () => parseAgentInput(request.payload ?? {}),
    onSuccess: (value, ceremony) => createdOutcome(pool, repo, value, ceremony),
  });
}

export async function updateAgentDefinition(
  pool: Pool,
  request: Request,
  target: { repo: string; name: string },
): Promise<WriteOutcome> {
  return performAgentWrite({
    pool,
    request,
    repo: target.repo,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- genuinely null on empty body
    parseFunc: () => parseAgentPatch(request.payload ?? {}),
    onSuccess: (value, ceremony) =>
      updatedOutcome(pool, target, value, ceremony),
  });
}

type WriteOpts<P> = {
  pool: Pool;
  request: Request;
  repo: string;
  parseFunc: () => P;
  onSuccess: (value: P, ceremony: Ceremony) => Promise<WriteOutcome>;
};

async function performAgentWrite<
  P extends { model?: string | null; image?: string | null },
>(opts: WriteOpts<P>): Promise<WriteOutcome> {
  const parsed = parsedOrInvalid(opts.parseFunc);

  if (!parsed.ok) {
    return parsed.failure;
  }

  const check = await checkModelSupport(
    opts.pool,
    opts.request,
    parsed.value.model,
  );

  if (check) {
    return check;
  }

  return finalizeWrite(opts, parsed.value);
}

async function finalizeWrite<
  P extends { model?: string | null; image?: string | null },
>(opts: WriteOpts<P>, value: P): Promise<WriteOutcome> {
  const res = await resolveCeremony({
    request: opts.request,
    repo: opts.repo,
    imageTouched: imageFieldTouched(value),
  });

  if (res.gate && !res.gate.ok) {
    return { code: res.gate.code, body: res.gate.body };
  }

  return opts.onSuccess(value, res.ceremony);
}

async function checkModelSupport(
  pool: Pool,
  request: Request,
  model: string | null | undefined,
): Promise<WriteOutcome | null> {
  if (!model || request.query.force === "true") {
    return null;
  }

  const list = await PgClusterAgents(pool).list();
  const reporting = list.filter(
    (a) => a.status === "active" && a.cluster_info != null,
  );

  if (reporting.length === 0) {
    return null; // absence is not refusal
  }

  return evalSupport(reporting, model);
}

function evalSupport(
  reporting: ClusterAgent[],
  model: string,
): WriteOutcome | null {
  const isSupported = reporting.some((agent) => {
    const served = agent.cluster_info?.served_models;

    return served ? served.includes(model) : false;
  });

  if (isSupported) {
    return null;
  }

  return {
    code: 400,
    body: {
      error: `No live cluster serves the model family "${model}". Pass ?force=true to save anyway.`,
    },
  };
}

function parsedOrInvalid<T>(
  parse: () => T,
): { ok: true; value: T } | { ok: false; failure: WriteOutcome } {
  try {
    return { ok: true, value: parse() };
  } catch (err) {
    const errorBody = { error: "invalid_agent", issues: issuesOf(err) };

    return { ok: false, failure: { code: 400, body: errorBody } };
  }
}

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

async function writeNewDefinition(
  project: Awaited<ReturnType<typeof projectFor>>,
  create: ReturnType<typeof parseAgentInput>,
) {
  const { pod_resources, ...fields } = create;
  const merged = await createFieldsWithPodResources(
    project.agentDefs,
    fields,
    pod_resources,
  );

  return project.agentDefs.create(merged);
}

async function updatedOutcome(
  pool: Pool,
  target: { repo: string; name: string },
  patch: ReturnType<typeof parseAgentPatch>,
  ceremony: Ceremony,
): Promise<WriteOutcome> {
  const project = await projectFor(target.repo);
  const def = await writePatchedDefinition(project, target.name, patch);

  await audit(pool, target.repo, "agent_updated", {
    name: target.name,
    ceremony,
  });

  return { code: 200, body: { ok: true, agent: def, ceremony } };
}

async function writePatchedDefinition(
  project: Awaited<ReturnType<typeof projectFor>>,
  name: string,
  patch: ReturnType<typeof parseAgentPatch>,
) {
  const { pod_resources, ...fields } = patch;
  const resources = await resolvePodResourcesUpdate(
    project.agentDefs,
    name,
    pod_resources,
  );

  return project.agentDefs.update(name, fields, resources);
}
