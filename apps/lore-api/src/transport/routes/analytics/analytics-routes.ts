import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { usageRoute } from "./usage.js";
import { analyticsRoute } from "./analytics.js";
import { activityRoutes } from "./activity.js";
import { analyticsOverviewRoute } from "./spend.js";
import { spendWindowRoute } from "./spend-window.js";
import { agentStatsRoute } from "./agent-stats.js";

/** What the platform cost and what it did. */
export function analyticsRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    usageRoute(getPool),
    analyticsRoute(getPool),
    ...activityRoutes(getPool),
    spendWindowRoute(getPool),
    analyticsOverviewRoute(getPool),
    agentStatsRoute(getPool),
  ];
}
