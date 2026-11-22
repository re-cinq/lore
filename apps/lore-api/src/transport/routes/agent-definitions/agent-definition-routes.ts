import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { agentDefinitionUsageRoute } from "./usage.js";
import { agentDefinitionActivityRoute } from "./activity.js";
import { orgAgentDefinitionsRoute } from "./org-list.js";
import { agentPresenceRoute } from "./presence.js";
import { orgAgentDefinitionUpdateRoute } from "./org-update.js";
import { orgAgentDefinitionArchiveRoute } from "./org-archive.js";
import {
  agentsGetRoute,
  agentsPostRoute,
  agentsPutRoute,
  agentsDeleteRoute,
} from "./agents.js";

/** The recipes a run resolves by name, read and edited here. */
export function agentDefinitionRoutes(
  getPool: () => Pool | null,
): ServerRoute[] {
  return [
    agentsGetRoute(getPool),
    agentDefinitionUsageRoute(),
    agentDefinitionActivityRoute(),
    orgAgentDefinitionsRoute(getPool),
    agentPresenceRoute(),
    orgAgentDefinitionUpdateRoute(getPool),
    orgAgentDefinitionArchiveRoute(getPool),
    agentsPostRoute(getPool),
    agentsPutRoute(getPool),
    agentsDeleteRoute(getPool),
  ];
}
