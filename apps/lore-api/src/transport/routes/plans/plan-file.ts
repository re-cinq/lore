// The plan file a planning pod edits (ADR-047), for the Floor to carry: GET renders the live plan as plan.md, POST takes the edited file back. Both sit under /api/plans, so the plan route guard holds them to lore's bearer tokens.

import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  applyPlanFile,
  planAgentView,
  planMarkdown,
  type PlanFilePorts,
} from "../../../work/plans/plan-file.js";
import { settleRefine } from "../../../work/plans/refine-settled.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

export function planFileRoutes(ports: PlanFilePorts): ServerRoute[] {
  return [
    markdownRoute(ports),
    agentViewRoute(ports),
    agentFileRoute(ports),
    refineFailedRoute(ports),
    refineSettledRoute(ports),
  ];
}

const RefineSettledBody = z.object({
  outcome: z.string().min(1),
  reason: z.string().optional(),
});

const RefineSettledSchema = z.object({
  settled: z.boolean(),
  slot: z.string().optional(),
});

const REFINE_SETTLED_OPTIONS = {
  ...zodResponse({}, RefineSettledSchema, {
    name: "PlanRefineSettled",
    description:
      "An analyze pass ended: its person's Refine is answered or told why not, and the ask is cleared",
    errors: [404],
  }),
  validate: { payload: zodValidate(RefineSettledBody) },
};

/** The analyze pass ended: lore-api withdraws the agent's presence, answers the section a person asked about (or says why it could not), and clears the ask. A pass nobody asked about settles nothing but still closes presence. */
function refineSettledRoute(ports: PlanFilePorts): ServerRoute {
  return {
    method: "POST",
    path: "/api/plans/{id}/refine-settled",
    options: REFINE_SETTLED_OPTIONS,
    handler: async (request) => {
      const planId = request.params.id;

      await closePresenceBestEffort(ports, planId);

      return settleRefine(
        planId,
        request.payload as z.infer<typeof RefineSettledBody>,
        ports,
      );
    },
  };
}

// A presence-close hiccup must not stop the Refine from being answered or the ask from being cleared.
async function closePresenceBestEffort(
  ports: PlanFilePorts,
  planId: string,
): Promise<void> {
  try {
    await ports.writer.closePresence({ planId });
  } catch (err) {
    console.warn(
      `[lore-api] plan-presence close failed for plan ${planId}: ${(err as Error).message}`,
    );
  }
}

const PlanAgentViewSchema = z.object({
  refine: z
    .object({ slot: z.string(), title: z.string(), brief: z.string() })
    .optional(),
  sections: z.array(
    z.object({
      slot: z.string(),
      title: z.string(),
      blocks: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          hash: z.string(),
          text: z.string(),
          props: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    }),
  ),
});

function agentViewRoute(ports: PlanFilePorts): ServerRoute {
  return {
    method: "GET",
    path: "/api/plans/{id}/agent-view",
    options: zodResponse({}, PlanAgentViewSchema, {
      name: "PlanAgentView",
      description:
        "The live plan as a person reads it: one section per slot, with its own blocks and their content only, and the section a person is waiting to have refined when there is one",
      errors: [404],
    }),
    handler: async (request) => planAgentView(request.params.id, ports),
  };
}

function markdownRoute(ports: PlanFilePorts): ServerRoute {
  return {
    method: "GET",
    path: "/api/plans/{id}/markdown",
    options: zodResponse({}, z.string(), {
      name: "PlanMarkdown",
      description: "The live plan as the plan.md a planning pod edits",
      contentType: "text/markdown",
      errors: [404],
    }),
    handler: async (request, h) =>
      h
        .response(await planMarkdown(request.params.id, ports))
        .type("text/markdown; charset=utf-8"),
  };
}

const PlanFileOutcomeSchema = z.object({
  written: z.number(),
  problems: z.array(
    z.object({
      code: z.string(),
      slot: z.string().optional(),
      message: z.string(),
    }),
  ),
});

const PlanFileBody = z.object({
  actor: z.string().min(1),
  markdown: z.string(),
  refine: z
    .object({
      slot: z.string().min(1),
      baseHash: z.string().min(1),
      uses: z.unknown().optional(),
    })
    .nullable(),
});

/** Twice the Floor's 64 MiB upload cap: the file arrives here JSON-escaped, and a newline escapes to two bytes. */
const MAX_PLAN_FILE_BYTES = 128 * 1024 * 1024;

const AGENT_FILE_OPTIONS = {
  ...zodResponse({}, PlanFileOutcomeSchema, {
    name: "PlanFileWritten",
    description:
      "The edited plan.md, written as agent edits (a draft) or proposed one change per paragraph for the Refine to take where each lands",
    errors: [400, 404],
  }),
  validate: { payload: zodValidate(PlanFileBody) },
  payload: { maxBytes: MAX_PLAN_FILE_BYTES },
};

function agentFileRoute(ports: PlanFilePorts): ServerRoute {
  return {
    method: "POST",
    path: "/api/plans/{id}/agent-file",
    options: AGENT_FILE_OPTIONS,
    handler: async (request) =>
      applyPlanFile(
        request.params.id,
        request.payload as z.infer<typeof PlanFileBody>,
        ports,
      ),
  };
}

const RefineFailedBody = z.object({
  slot: z.string().min(1),
  reason: z.string().min(1),
});

const REFINE_FAILED_OPTIONS = {
  ...zodResponse({}, z.object({ slot: z.string() }), {
    name: "PlanRefineFailed",
    description:
      "The Refine of one section is marked failed, with why its pass stopped, for its person to ask again",
    errors: [400, 404],
  }),
  validate: { payload: zodValidate(RefineFailedBody) },
};

function refineFailedRoute(ports: PlanFilePorts): ServerRoute {
  return {
    method: "POST",
    path: "/api/plans/{id}/refine-failed",
    options: REFINE_FAILED_OPTIONS,
    handler: async (request) => {
      const failed = request.payload as z.infer<typeof RefineFailedBody>;

      await ports.writer.failRefine({ planId: request.params.id, ...failed });

      return { slot: failed.slot };
    },
  };
}
