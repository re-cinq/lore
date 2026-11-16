import type { Lifecycle, Server } from "@hapi/hapi";
import type { Pool } from "pg";
import {
  registerPlanningSync,
  type PlanningSync,
} from "@re-cinq/planning-sync/hapi";
import type { PlanLifecycleHooks } from "@re-cinq/planning-sync";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { pgPlanStore } from "../outbound/plans/plan-store-pg.js";
import { livePlanOf } from "../outbound/plans/live-plan.js";
import { pgRefineAsks } from "../work/plans/refine-asks-pg.js";
import { planFileRoutes } from "../transport/routes/plans/plan-file.js";
import { planStoryRoutes } from "../transport/routes/plans/plan-story.js";
import { pgPlanStories } from "../work/plans/plan-stories-pg.js";
import {
  planStoryContext,
  type PlanStoryPorts,
} from "../work/plans/plan-story.js";
import { onboardedProject } from "../transport/routes/repos/github-read.js";
import { floorPlanLineState } from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import type { PlanFilePorts } from "../work/plans/plan-file.js";
import type { PlanLifecyclePorts } from "../transport/routes/plans/plan-lifecycle.js";
import { collabAuthenticator } from "../work/plans/collab-tokens.js";
import {
  planVerbsFor,
  type PlanVerbSeams,
} from "../transport/routes/plans/plan-verbs-for.js";
import {
  clearStaleAsks,
  type StaleAskDeps,
  type StalePlan,
} from "../work/plans/stale-refine-asks.js";
import { liveRefineAsks } from "../outbound/plans/refine-asks-live.js";
import { agentHasThePlan } from "../work/plans/refine-refusal.js";
import { DB_UNAVAILABLE } from "../transport/routes/common-schemas.js";
import {
  floorClient,
  floorConfigured,
  floorIfConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { planAgentPresenceOn } from "../work/plans/plan-agent-presence-floor.js";
import type { PresenceWriter } from "../work/plans/plan-agent-presence.js";
import type { TokenScope } from "../transport/http/auth.js";

export const PLANS_PREFIX = "/api/plans";

/** What the plans registration hands the rest of the server: the collaboration server the live socket tunnels to (ADR-048) and what the plan routes need to run their verbs. */
export interface RegisteredPlanning {
  collab: PlanningSync["collab"];
  plans: PlanVerbSeams;
}

/** Plans hosted in this process (@re-cinq/planning-sync): REST under /api/plans and the collaboration socket at /api/plans/collab, on lore-api's own listener. */
export function registerPlanning(
  server: Server,
  getPool: () => Pool | null,
  floorDeps?: PlanVerbSeams["floorDeps"],
): RegisteredPlanning {
  const pool = livePool(getPool);
  const seams: PlanVerbSeams = { floorDeps, pool };
  const sync = registerPlanningSync(server, {
    store: pgPlanStore(pool),
    authenticator: collabAuthenticator(pool),
    onApproved: (meta) => startSpecWork(meta, seams),
  });

  // onApproved reaches the library before the sync it reads the plan through exists, so the seams are filled once it does.
  seams.livePlan = livePlanOf(sync);
  seams.service = sync.service as PlanLifecyclePorts["service"];
  seams.clearStaleAsks = staleAskCheck(sync, seams);
  routePlans(server, sync, seams, { pool });
  followPlanAgents(server, sync.writer);

  return { collab: sync.collab, plans: seams };
}

// Lore's own plan routes — lifecycle routes (/approve etc.) are hoisted into routeList (ADR-035).
function routePlans(
  server: Server,
  sync: PlanningSync,
  seams: PlanVerbSeams,
  { pool }: { pool: () => Pool },
): void {
  const stories = storyPorts(pool, seams.floorDeps);

  server.route(
    planFileRoutes(filePorts(livePlanOf(sync), sync, pool, stories)),
  );
  server.route(planStoryRoutes(stories));
  server.ext("onPreHandler", planRouteGuard(server));
}

// The agent is shown on its plan from the floor's own runs, so a deployment with no floor shows it nowhere.
function followPlanAgents(server: Server, writer: PresenceWriter): void {
  if (!floorConfigured()) {
    return;
  }
  const presence = planAgentPresenceOn(floorClient(), writer);

  server.ext("onPostStart", () => presence.start());
  server.ext("onPreStop", () => presence.stop());
}

// A stale ask is only judged where a floor can say whether an agent holds the plan.
function staleAskCheck(sync: PlanningSync, seams: PlanVerbSeams) {
  return async (plan: StalePlan): Promise<unknown> => {
    const floor = seams.floorDeps?.floor ?? floorIfConfigured();

    return floor
      ? clearStaleAsks(liveAskDeps(sync, floor), plan, new Date())
      : [];
  };
}

function liveAskDeps(sync: PlanningSync, floor: PlanFloorReads): StaleAskDeps {
  return {
    asks: (subject) => liveRefineAsks(sync.collab, subject),
    agentWorking: async (subject) =>
      agentHasThePlan(
        await floorPlanLineState(floor, {
          repo: subject.repo,
          planId: subject.id,
        }),
      ),
    failRefine: (request) => sync.writer.failRefine(request),
  };
}

type PlanFloorReads = Parameters<typeof floorPlanLineState>[0];

// The pool, answering 503 while the database is away.
function livePool(getPool: () => Pool | null): () => Pool {
  return () => {
    const live = getPool();

    enforceTrue(live, apiError(503), DB_UNAVAILABLE);

    return live;
  };
}

// Approval ends the plan and starts its spec work on the same planning line — or, with no line waiting, on a fresh one entered at the spec analysis.
async function startSpecWork(
  meta: Parameters<NonNullable<PlanLifecycleHooks["onApproved"]>>[0],
  seams: PlanVerbSeams,
): Promise<void> {
  const verbs = await planVerbsFor(meta, seams);

  await verbs.handOverApproved(
    meta,
    meta.approval?.approvedBy ?? meta.createdBy,
  );
}

// The library's routes carry no hapi auth of their own, so every /api/plans call is held to lore's bearer tokens here: any valid token reads, a write needs the `write` scope. The socket is an upgrade, not a route, and answers to its collab token instead.
const planRouteGuard =
  (server: Server): Lifecycle.Method =>
  async (request, h) => {
    if (!request.path.startsWith(PLANS_PREFIX)) {
      return h.continue;
    }
    const { credentials } = await server.auth.test("bearer-scope", request);
    const scopes = credentials.scope as TokenScope[];

    enforceTrue(
      request.method === "get" ||
        scopes.includes("write") ||
        scopes.includes("admin"),
      apiError(403),
      "insufficient scope",
    );

    return h.continue;
  };

function filePorts(
  livePlan: PlanFilePorts["livePlan"],
  sync: { writer: PlanFilePorts["writer"] },
  pool: () => Pool,
  stories: PlanStoryPorts,
): PlanFilePorts {
  return {
    livePlan,
    writer: sync.writer,
    refineAsks: pgRefineAsks(pool),
    story: (planId) => planStoryContext(planId, stories, readIssueOnGitHub),
  };
}

// The repository's own GitHub client, as every issue read in lore-api reaches it.
async function readIssueOnGitHub(repo: string, number: number) {
  const project = await onboardedProject(repo);

  return project.issues.get(number);
}

// The newest run's story is read from the deployment's own floor, and a deployment with none has no run to read.
function storyPorts(
  pool: () => Pool,
  floorDeps: PlanVerbSeams["floorDeps"],
): PlanStoryPorts {
  const store = pgPlanStore(pool);

  return {
    plan: (planId) => store.getMeta(planId),
    stories: pgPlanStories(pool),
    runStory: async (plan) =>
      runStoryOn(floorDeps?.floor ?? floorIfConfigured(), plan),
  };
}

async function runStoryOn(
  floor: Parameters<typeof floorPlanLineState>[0] | null,
  { id, repo }: { id: string; repo: string },
): Promise<number | null> {
  if (!floor) {
    return null;
  }
  const line = await floorPlanLineState(floor, { repo, planId: id });

  return line?.storyIssue ?? null;
}
