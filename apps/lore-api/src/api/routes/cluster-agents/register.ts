import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  extractBearer,
  secretEquals,
} from "@re-cinq/lore-shared/http/bearer.js";
import { apiError } from "../../../server/api-error.js";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import {
  decideRegistration,
  type ClusterAgentsRepository,
  type RegistrationDecision,
} from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import {
  mintAgentToken,
  hashAgentToken,
} from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
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

export interface RegisterDeps {
  repository: ClusterAgentsRepository;
  registrationToken: string | undefined;
}

/** The handler core, injectable for tests: gate, decide, mint, persist. */
export async function handleRegister(
  deps: RegisterDeps,
  bearer: string | undefined,
  body: RegisterBody,
): Promise<
  | { code: 200; body: z.infer<typeof RegisterResponse> }
  | { code: 401 | 409 | 503; body: { error: string } }
> {
  if (
    !deps.registrationToken ||
    !bearer ||
    !secretEquals(bearer, deps.registrationToken)
  ) {
    return { code: 401, body: { error: "unauthorized" } };
  }

  const existing = await deps.repository.findByName(body.name);
  const presented = body.current_token ?? "";
  const decision: RegistrationDecision = decideRegistration(
    existing,
    presented ? hashAgentToken(presented) : null,
  );

  if (decision.kind === "reject") {
    return {
      code: 409,
      body: { error: "name is registered to a live identity" },
    };
  }

  // Re-registering KEEPS its token: rotating would 401 running pods already holding the credential (#1587).
  const issued =
    decision.kind === "create"
      ? mintAgentToken()
      : { token: presented, tokenHash: decision.tokenHash };
  const input = {
    name: body.name,
    tags: body.tags,
    tokenHash: issued.tokenHash,
    clusterInfo: body.cluster_info,
  };
  const agent =
    decision.kind === "create"
      ? await deps.repository.create(input)
      : await deps.repository.refresh(decision.id, input);

  if (agent === null) {
    // Lost a concurrent registration — same as a taken name.
    return {
      code: 409,
      body: { error: "name is registered to a live identity" },
    };
  }

  return {
    code: 200,
    body: {
      id: agent.id,
      name: agent.name,
      tags: agent.tags,
      token: issued.token,
    },
  };
}

export function clusterAgentRegisterRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster-agents/register",
    options: zodResponse(
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
    ),
    handler: async (request: Request, h: ResponseToolkit) => {
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
    },
  };
}
