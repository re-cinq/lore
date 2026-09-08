import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { secretEquals } from "@re-cinq/lore-shared/lib/secret-equals.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import {
  decideRegistration,
  type ClusterAgentsRepository,
  type RegisterClusterAgentInput,
  type RegistrationDecision,
} from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import type { ClusterAgent } from "@re-cinq/lore-shared/models/cluster-agent.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import {
  mintAgentToken,
  hashAgentToken,
} from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/** Cluster registration: joins the registry and receives a per-agent token (FR1). */

/** Byte budget prevents a compromised token from unbounded registry growth. */
const CLUSTER_INFO_MAX_BYTES = 16 * 1024;

const RegisterBody = z.object({
  name: z.string().min(1).max(200),
  tags: z.array(z.string().max(100)).max(50).default([]),
  cluster_info: z
    .record(z.string(), z.unknown())
    .nullable()
    .default(null)
    .refine(
      (value) =>
        value === null ||
        Buffer.byteLength(JSON.stringify(value)) <= CLUSTER_INFO_MAX_BYTES,
      `cluster_info exceeds ${CLUSTER_INFO_MAX_BYTES} bytes`,
    ),
  current_token: z.string().optional(),
});

type RegisterBody = z.infer<typeof RegisterBody>;

const RegisterResponse = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  token: z.string(),
});

/** What a registration can answer with: the identity and its token, or the name refusal. */
type RegisterResult =
  | { code: 200; body: z.infer<typeof RegisterResponse> }
  | { code: 409; body: { error: string } };

export interface RegisterDeps {
  repository: ClusterAgentsRepository;
  registrationToken: string | undefined;
}

function isUnauthorizedRegistration(
  deps: RegisterDeps,
  bearer: string | undefined,
): boolean {
  return (
    !deps.registrationToken ||
    !bearer ||
    !secretEquals(bearer, deps.registrationToken)
  );
}

type IssuableDecision = Exclude<RegistrationDecision, { kind: "reject" }>;

/** Re-registering KEEPS its token: rotating would 401 running pods already holding the credential (#1587). */
function issueTokenForDecision(
  decision: IssuableDecision,
  presented: string,
): { token: string; tokenHash: string } {
  return decision.kind === "create"
    ? mintAgentToken()
    : { token: presented, tokenHash: decision.tokenHash };
}

function persistRegistration(
  deps: RegisterDeps,
  decision: IssuableDecision,
  input: RegisterClusterAgentInput,
): Promise<ClusterAgent | null> {
  return decision.kind === "create"
    ? deps.repository.create(input)
    : deps.repository.refresh(decision.id, input);
}

const NAME_TAKEN = {
  code: 409 as const,
  body: { error: "name is registered to a live identity" },
};

/** The registered identity as the agent sees it. The token appears here and nowhere else — only its hash is stored. */
function registeredBody(
  agent: ClusterAgent,
  token: string,
): z.infer<typeof RegisterResponse> {
  return { id: agent.id, name: agent.name, tags: agent.tags, token };
}

/** The handler core, injectable for tests: gate, decide, mint, persist. */
/** Writes the registration and answers with the token. Losing a concurrent registration reads the same as a taken NAME — another process holds it either way, and the loser must re-register rather than assume it won. The token is served here and never again: only its hash is stored. */
async function registerAgent(
  deps: RegisterDeps,
  body: RegisterBody,
  decision: IssuableDecision,
  presented: string,
): Promise<RegisterResult> {
  const issued = issueTokenForDecision(decision, presented);
  const agent = await persistRegistration(deps, decision, {
    name: body.name,
    tags: body.tags,
    tokenHash: issued.tokenHash,
    clusterInfo: body.cluster_info,
  });

  if (agent === null) {
    return NAME_TAKEN;
  }

  return { code: 200, body: registeredBody(agent, issued.token) };
}

export async function handleRegister(
  deps: RegisterDeps,
  bearer: string | undefined,
  body: RegisterBody,
): Promise<RegisterResult | { code: 401 | 503; body: { error: string } }> {
  if (isUnauthorizedRegistration(deps, bearer)) {
    return { code: 401, body: { error: "unauthorized" } };
  }

  const presented = body.current_token ?? "";
  const decision: RegistrationDecision = decideRegistration(
    await deps.repository.findByName(body.name),
    presented ? hashAgentToken(presented) : null,
  );

  if (decision.kind === "reject") {
    return NAME_TAKEN;
  }

  return registerAgent(deps, body, decision, presented);
}

/** A cluster-agent introducing itself. Registration is mandatory in every cluster: nothing is ever pushed to an agent, so an unregistered process would simply never be given work. */
async function serveRegister(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const bearer = extractBearer(request.headers.authorization);

  const result = await handleRegister(
    {
      repository: new PgClusterAgents(pool),
      registrationToken: process.env.LORE_CLUSTER_AGENT_REGISTRATION_TOKEN,
    },
    bearer,
    request.payload as RegisterBody,
  );

  return h.response(result.body).code(result.code);
}

const REGISTER_OPTIONS = zodResponse(
  {
    auth: false,
    validate: { payload: zodValidate(RegisterBody) },
  },
  RegisterResponse,
  {
    name: "ClusterAgentRegistration",
    description:
      "The registered identity with its per-agent token — served once and never again",
    errors: [401, 409],
  },
);

export function clusterAgentRegisterRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster-agents/register",
    options: REGISTER_OPTIONS,
    handler: (request, h) => serveRegister(getPool, request, h),
  };
}
