// The user story a plan was saved with, for the plan page and the ticket-filing station to share (specs/7-feature-planning FR-18). Both sit under /api/plans, so the plan route guard holds them to lore's bearer tokens.

import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  readPlanStory,
  savePlanStory,
  type PlanStoryPorts,
} from "../../../work/plans/plan-story.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

export function planStoryRoutes(ports: PlanStoryPorts): ServerRoute[] {
  return [readRoute(ports), saveRoute(ports)];
}

const PlanStorySchema = z.object({
  issueNumber: z.number().int().nullable(),
  issueUrl: z.string().nullable(),
});

const SaveBody = z.object({
  issueNumber: z.number().int().positive().nullable(),
  setBy: z.string().min(1),
});

function readRoute(ports: PlanStoryPorts): ServerRoute {
  return {
    method: "GET",
    path: "/api/plans/{id}/story",
    options: zodResponse({}, PlanStorySchema, {
      name: "PlanStory",
      description:
        "The user story issue a plan has: the one saved on it, or when none was ever saved the one its newest planning run carries",
      errors: [404],
    }),
    handler: (request) => readPlanStory(request.params.id, ports),
  };
}

const SAVE_OPTIONS = {
  ...zodResponse({}, PlanStorySchema, {
    name: "PlanStorySaved",
    description:
      "The plan's user story after the save: an issue number, or none when the link was removed",
    errors: [400, 404],
  }),
  validate: { payload: zodValidate(SaveBody) },
};

function saveRoute(ports: PlanStoryPorts): ServerRoute {
  return {
    method: "POST",
    path: "/api/plans/{id}/story",
    options: SAVE_OPTIONS,
    handler: (request) =>
      savePlanStory(
        request.params.id,
        request.payload as z.infer<typeof SaveBody>,
        ports,
      ),
  };
}
