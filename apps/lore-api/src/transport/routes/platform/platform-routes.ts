import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { healthzRoute } from "../healthz/healthz.js";
import { distRoute } from "../dist/dist.js";
import { llmStatusRoute } from "./llm-status.js";
import { serviceVersionsRoute, versionsRoute } from "./versions.js";

/** What the service says about itself: health, model status, the versions of every Lore part, and the binary it serves. */
export function selfRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    healthzRoute(getPool),
    llmStatusRoute(getPool),
    versionsRoute(getPool),
    serviceVersionsRoute(getPool),
    distRoute(),
  ];
}
