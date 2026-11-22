import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { Pool } from "pg";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  ApiTokenSchema,
  API_TOKEN_COLUMNS,
} from "@re-cinq/lore-shared/models/api-token.js";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope, principalOf } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import type { Principal, TokenScope, UserIdentity } from "../../http/auth.js";
import {
  DB_UNAVAILABLE,
  clampedLimit,
  offsetParam,
} from "../common-schemas.js";
import { OkSchema } from "../../http/ok-schema.js";
import { runInTransaction } from "@re-cinq/lore-shared";
import {
  enforceSessionCurrent,
  lockPerson,
} from "../../../work/auth/person-access.js";
import {
  mintApiToken,
  type MintInput,
} from "../../../work/tokens/mint-token.js";

interface TokensPostBody {
  action?: string;
  name?: string;
  scopes?: string[];
  expires_in_days?: number;
  token_id?: string;
  kind?: string;
}

// GET query paging (POST never reads query, so no validation there).
const TokensQuery = z.object({
  limit: clampedLimit.default(20),
  offset: offsetParam,
});

type TokensQuery = z.infer<typeof TokensQuery>;

/** Token surface omits token_hash (exists once at creation only). */
const TokenListSchema = z.object({
  tokens: z.array(
    wireSchema(
      ApiTokenSchema.pick({
        id: true,
        name: true,
        scopes: true,
        createdBy: true,
        expiresAt: true,
        lastUsed: true,
        createdAt: true,
      }),
      API_TOKEN_COLUMNS,
    ),
  ),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

const TokenWriteSchema = z.union([
  OkSchema,
  z.object({
    id: z.string(),
    name: z.string(),
    token: z.string(),
    scopes: z.array(z.string()),
    expires_at: z.string().nullable(),
  }),
]);

const VALID_TOKEN_SCOPES: TokenScope[] = [
  "read",
  "write",
  "task",
  "webhook",
  "admin",
];

/** GET lists, POST writes (separate shapes); wildcard 405 fallback (validation skipped). The listing NEVER serves the hash — it is the only stored form of a token, and serving it would make the store as good as the token itself. */
const LIST_OPTIONS = zodResponse(
  {
    ...bearerScope("admin"),
    validate: { query: zodValidate(TokensQuery) },
  },
  TokenListSchema,
  {
    name: "TokenList",
    description: "A page of active tokens; the hash is never served",
  },
);

/** The write answers with the created token ONCE. There is no second read: only its hash is stored, so a caller who loses it mints a new one. */
const WRITE_OPTIONS = zodResponse(bearerScope("admin"), TokenWriteSchema, {
  name: "TokenWriteResult",
  description:
    "The revoke acknowledgement, or the created token — served once and never again",
  errors: [400],
});

export function tokensRoute(getPool: () => Pool | null): ServerRoute[] {
  return [
    {
      method: "GET",
      path: "/api/tokens",
      options: LIST_OPTIONS,
      handler: (request, h) => listTokens(getPool(), request, h),
    },
    {
      method: "POST",
      path: "/api/tokens",
      options: WRITE_OPTIONS,
      handler: (request, h) => writeToken(getPool(), request, h),
    },
    tokensMethodNotAllowedRoute(),
  ];
}

async function listTokens(
  pool: Pool | null,
  request: Request,
  h: ResponseToolkit,
) {
  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const query = request.query as unknown as TokensQuery;

  return h.response(await fetchTokenPage(pool, query));
}

// One page of active tokens (never returns the actual token) plus the full count.
async function fetchTokenPage(pool: Pool, { limit, offset }: TokensQuery) {
  const { rows } = await pool.query(
    `SELECT id, name, scopes, created_by, expires_at, last_used, created_at
       FROM pipeline.api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int as total FROM pipeline.api_tokens WHERE revoked_at IS NULL`,
  );

  return { tokens: rows, total: countRows[0].total, limit, offset };
}

async function writeToken(
  pool: Pool | null,
  request: Request,
  h: ResponseToolkit,
) {
  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hapi types omit it, but request.payload is genuinely null for an empty body.
    const body = (request.payload ?? {}) as TokensPostBody;

    if (isRevoke(body)) {
      return revokeToken(pool, h, body.token_id);
    }

    return await createToken(pool, h, body, principalOf(request));
  } catch (err) {
    // Guard refusals carry their status; shape only unexpected failures.
    rethrowBoom(err);

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

function isRevoke(body: TokensPostBody): body is TokensPostBody & {
  token_id: string;
} {
  return body.action === "revoke" && Boolean(body.token_id);
}

async function revokeToken(pool: Pool, h: ResponseToolkit, tokenId: string) {
  await pool.query(
    `UPDATE pipeline.api_tokens SET revoked_at = now() WHERE id = $1`,
    [tokenId],
  );

  return h.response({ ok: true });
}

async function createToken(
  pool: Pool,
  h: ResponseToolkit,
  body: TokensPostBody,
  { user: maker, tokenHash }: Pick<Principal, "user" | "tokenHash">,
) {
  enforceTrue(body.name, apiError(400), "name required");
  refuseInstallKind(body.kind);
  const input = mintInput(body.name, body, maker);
  const { token, row } = await mintedBy(pool, maker, tokenHash, input);

  // Return the raw token ONCE — it cannot be retrieved again
  return h
    .response({
      ...row,
      token,
      expires_at: input.expiresAt?.toISOString() ?? null,
    })
    .code(201);
}

function mintInput(
  name: string,
  body: TokensPostBody,
  maker: UserIdentity | null,
): MintInput {
  return {
    name,
    scopes: resolveScopes(body.scopes),
    createdBy: maker?.login ?? "admin",
    expiresAt: expiryDate(body.expires_in_days),
    ...makerColumns(maker),
  };
}

/** FR-044: a token a signed-in person mints records their GitHub numeric id. */
function makerColumns(maker: UserIdentity | null): Partial<MintInput> {
  if (!maker) {
    return {};
  }

  return {
    user: {
      login: maker.login,
      displayName: maker.name,
      avatarUrl: maker.avatarUrl ?? "",
      repos: [],
      githubId: maker.githubId,
    },
  };
}

/** A person's session mints under the person's lock, so a sign-out or revocation of that person cannot interleave with the insert (FR-389), and mints nothing once its session has ended or its generation is out of date (FR-396, FR-438). */
async function mintedBy(
  pool: Pool,
  maker: UserIdentity | null,
  sessionHash: string | null,
  input: MintInput,
) {
  if (!maker) {
    return mintApiToken(pool, input);
  }

  return runInTransaction(pool, async (tx) => {
    await lockPerson(tx, maker.githubId);
    await enforceSessionCurrent(tx, sessionHash, maker.githubId);

    return mintApiToken(tx, input);
  });
}

function resolveScopes(scopes: string[] | undefined): TokenScope[] {
  return (scopes || ["read"]).filter(isTokenScope);
}

function isTokenScope(scope: string): scope is TokenScope {
  return VALID_TOKEN_SCOPES.includes(scope as TokenScope);
}

function expiryDate(expiresInDays: number | undefined): Date | null {
  return expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;
}

// Fallback only — a concrete verb above always wins in hapi.
function tokensMethodNotAllowedRoute(): ServerRoute {
  return {
    method: "*",
    path: "/api/tokens",
    options: bearerScope("admin"),
    handler: (_request: Request, h: ResponseToolkit) =>
      h.response({ error: "method not allowed" }).code(405),
  };
}

/** FR-047, FR-178: the stations and emergency tokens are the install's own, never minted through this route. */
function refuseInstallKind(kind: string | undefined): void {
  enforceTrue(
    kind !== "stations" && kind !== "station",
    apiError(400),
    "the stations token is provisioned by the install, not minted",
  );
  enforceTrue(
    kind !== "emergency",
    apiError(400),
    "an emergency token is provisioned by the operator, not minted",
  );
}
