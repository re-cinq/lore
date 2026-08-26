import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
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

/**
 * POST /api/cluster-agents/register — a cluster-agent joins the registry
 * (FR1 of specs/running-stations-in-any-k8s-cluster).
 *
 * Auth is the pre-shared registration token, NOT the bearer-scope strategy:
 * the caller is a cluster that has no scoped token yet — the whole point of
 * the call is to receive one. Identity takeover is blocked by the decision
 * gate: a known name re-registers only by presenting its current per-agent
 * token in `current_token`; the registration token alone is rejected 409.
 *
 * The plaintext per-agent token exists once, in this response.
 */

const RegisterBody = z.object({
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
  cluster_info: z.record(z.string(), z.unknown()).nullable().default(null),
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
  if (!deps.registrationToken || bearer !== deps.registrationToken) {
    return { code: 401, body: { error: "unauthorized" } };
  }

  const existing = await deps.repository.findByName(body.name);
  const decision: RegistrationDecision = decideRegistration(
    existing,
    body.current_token ? hashAgentToken(body.current_token) : null,
  );

  if (decision.kind === "reject") {
    return {
      code: 409,
      body: { error: "name is registered to a live identity" },
    };
  }

  const minted = mintAgentToken();
  const input = {
    name: body.name,
    tags: body.tags,
    tokenHash: minted.tokenHash,
    clusterInfo: body.cluster_info,
  };
  const agent =
    decision.kind === "create"
      ? await deps.repository.create(input)
      : await deps.repository.rotate(decision.id, input);

  return {
    code: 200,
    body: {
      id: agent.id,
      name: agent.name,
      tags: agent.tags,
      token: minted.token,
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
        errors: [409],
      },
    ),
    handler: async (request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const authHeader = request.headers.authorization;
      const bearer = (
        Array.isArray(authHeader) ? authHeader[0] : authHeader
      )?.replace("Bearer ", "");

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
