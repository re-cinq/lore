import "@re-cinq/lore-shared/http/hapi-params.js";
/** Lore-api HTTP server construction (hapi, ADR-033); shared by production and tests via buildServer. */

import type { Pool } from "pg";
import { collabLivenessExtension } from "../work/plans/collab-liveness.js";
import { routeList } from "../transport/route-list.js";
import type { PlanVerbSeams } from "../transport/routes/plans/plan-verbs-for.js";
import Hapi from "@hapi/hapi";
import type { ServerRoute } from "@hapi/hapi";
import { registerRequestTracing } from "@re-cinq/lore-shared/http/tracing.js";
import { traceHttp } from "@re-cinq/lore-server-core/platform/otel.js";
import { rateLimit, resolvePrincipal } from "../transport/http/auth.js";
import { trustedClientAddress } from "../transport/http/client-ip.js";
import { registerRateLimit } from "../transport/http/rate-limit.js";
import { registerBearerScope } from "../transport/http/bearer-scope.js";
import { registerRunRepoGuard } from "../transport/http/run-repo-guard.js";
import {
  registerRepoAlias,
  type MirrorOwnerOf,
} from "../transport/http/repo-alias.js";
import { registerPersonAppClientGuard } from "../transport/http/person-request-context.js";
import { registerRepoGuard } from "../transport/http/repo-guard.js";
import { createRepoAccess } from "../work/auth/repo-access.js";
import { personGithubEnv } from "../work/auth/person-github-env.js";
import { repoAccessPorts } from "../outbound/repo-access-ports.js";
import { deleteExpiredHandoffs } from "../work/auth/login-handoffs.js";
import { runRepoOf } from "../work/auth/run-repo.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodFailAction } from "../transport/http/zod-validate.js";
import {
  generateOpenApi,
  summarizeCoverage,
} from "../transport/openapi/build-document.js";
import { MAX_JSON_BODY_BYTES } from "@re-cinq/lore-shared/http/body-limits.js";
import { logRequestErrors } from "@re-cinq/lore-shared/http/server-boot.js";
import {
  registerPlanning,
  type RegisteredPlanning,
} from "./register-planning.js";
import {
  closeCollabSession,
  type CollabConnections,
} from "../work/plans/collab-sessions.js";
import { onSessionEnded } from "../work/auth/session-ended.js";
import { listenForSessionEnds } from "../work/auth/session-ended-listener.js";
import {
  mountLiveSocket,
  type LiveSocketLimits,
} from "../work/assembly-line-station/live-socket.js";
import {
  planRunChannelDepsFromPool,
  runChannelDepsFromPool,
  runsChannelDepsFromPool,
} from "../work/assembly-line-station/station-wiring.js";

// `traceHttp` is the metric half the span does not carry — lore-api recorded it per request before the tracing plugin was shared, and still does.
const TRACING = { tracerName: "lore.api.http", observe: traceHttp };

/** `planFloor` stands in for the deployment's floor under the plan routes; a test hands in a recorded one, and `mirrorOwnerOf` the lookup of the repository a public mirror stands for; with the default, no repository has a mirror. */
export function buildServer(
  getPool: () => Pool | null,
  port = 0,
  planFloor?: PlanVerbSeams["floorDeps"],
  mirrorOwnerOf: MirrorOwnerOf = async () => null,
): Hapi.Server {
  const server = newServer(port);

  logRequestErrors(server);
  registerRequestTracing(server, TRACING);
  registerRateLimit(server);
  registerBearerScope(server, getPool);
  registerRepoAlias(server, mirrorOwnerOf);
  registerRepoGuard(server, personRepoAccess(getPool));
  registerRunRepoGuard(server, (runId) => runRepoOf(poolOf(getPool), runId));

  const routes = registerRoutes(server, getPool, planFloor);

  // Surface OpenAPI coverage at boot (FR7, drift-guard test enforces via CI).
  if (!process.env.VITEST) {
    logOpenApiCoverage(routes);
  }

  return server;
}

/** The guard asks GitHub with the person's own Step 3 token (FR-009). */
function personRepoAccess(getPool: () => Pool | null) {
  return createRepoAccess(
    repoAccessPorts(getPool, process.env, (pool, tokenHash) =>
      personGithubEnv(pool, { person: true, tokenHash }),
    ),
  );
}

function poolOf(getPool: () => Pool | null): Pool {
  const pool = getPool();

  enforceTrue(pool !== null, Error, "database unavailable");

  return pool;
}

function newServer(port: number): Hapi.Server {
  return Hapi.server({
    port,
    host: "0.0.0.0",
    routes: {
      // ADR-034: parse JSON regardless of Content-Type (preserve pre-hapi agnostic behavior).
      payload: { maxBytes: MAX_JSON_BODY_BYTES, override: "application/json" },
      // Zod schemas fail through zodFailAction, shaping every 400 as { error }.
      validate: { failAction: zodFailAction },
    },
  });
}

/** Plans register first: the plan routes run on what that registration hands back, and the live socket tunnels to its collaboration server (ADR-048). */
function registerRoutes(
  server: Hapi.Server,
  getPool: () => Pool | null,
  planFloor: PlanVerbSeams["floorDeps"],
): ServerRoute[] {
  registerPersonAppClientGuard(server);
  const { collab, plans } = registerPlanning(server, getPool, planFloor);
  const routes = routeList(getPool, plans);

  registerHandoffCleanup(server, getPool);
  server.route(routes);
  registerLiveSocket(server, getPool, collab);

  return routes;
}

const HANDOFF_CLEANUP_INTERVAL_MS = 60_000;

/** FR-433: once a minute, expired login handoff rows go, whether or not anyone signs in. */
function registerHandoffCleanup(
  server: Hapi.Server,
  getPool: () => Pool | null,
): void {
  const timer = setInterval(() => {
    const pool = getPool();

    if (pool) {
      deleteExpiredHandoffs(pool).catch((error: unknown) =>
        console.warn("[login-handoffs] cleanup failed", error),
      );
    }
  }, HANDOFF_CLEANUP_INTERVAL_MS);

  timer.unref();
  server.ext("onPreStop", () => clearInterval(timer));
}

const LIVE_SOCKET_LIMITS: LiveSocketLimits = {
  addressOf: (request) =>
    trustedClientAddress(
      request.socket.remoteAddress,
      request.headers["x-forwarded-for"],
    ),
  allowUpgrade: (address) => rateLimit("ws", address),
  allowOpen: (connection) => rateLimit("wsOpen", connection),
};

function registerLiveSocket(
  server: Hapi.Server,
  getPool: () => Pool | null,
  collab: RegisteredPlanning["collab"],
): void {
  const run = runChannelDepsFromPool(getPool);
  const liveSocket = mountLiveSocket(server.listener, {
    run,
    runs: runsChannelDepsFromPool(getPool),
    planRun: planRunChannelDepsFromPool(getPool, run),
    collab,
    person: async (token) =>
      (await resolvePrincipal(getPool(), token))?.user ?? null,
    inject: (options) => server.inject(options),
    limits: LIVE_SOCKET_LIMITS,
  });

  closeOnSessionEnd(server, liveSocket, collab);
  checkCollabSessions(getPool, collab);
}

/** FR-305: an open plan collaboration connection asks again whether its session is open at the first frame after five minutes. */
function checkCollabSessions(
  getPool: () => Pool | null,
  collab: RegisteredPlanning["collab"],
): void {
  const extension = collabLivenessExtension(async (sessionId) => {
    const { rows } = await poolOf(getPool).query(
      `SELECT 1 FROM pipeline.api_tokens WHERE id::text = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [sessionId],
    );

    return rows.length > 0;
  });
  const { configuration } = collab as unknown as {
    configuration: { extensions: unknown[] };
  };

  configuration.extensions.push(extension);
}

/** FR-279: a session that ends closes the live sockets opened with it. */
function closeOnSessionEnd(
  server: Hapi.Server,
  liveSocket: ReturnType<typeof mountLiveSocket>,
  collab: RegisteredPlanning["collab"],
): void {
  const unsubscribe = onSessionEnded((id) => {
    liveSocket.closeSession(id);
    closeCollabSession(collab as unknown as CollabConnections, id);
  });
  const stopListening = listenForSessionEnds();

  server.ext("onPreStop", () => {
    unsubscribe();
    stopListening();
    liveSocket.close();
  });
}

function logOpenApiCoverage(routes: ServerRoute[]): void {
  const { coverage } = generateOpenApi(routes);

  console.log(summarizeCoverage(coverage));

  if (coverage.uncovered.length) {
    console.warn(
      `[openapi] WARNING uncovered write routes: ${coverage.uncovered.join(", ")}`,
    );
  }
}
