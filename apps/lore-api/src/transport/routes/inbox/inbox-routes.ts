import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { inboxItemStatePutRoute } from "./inbox-item-state-put.js";
import { inboxRoute } from "./inbox.js";

/** A person's inbox: its items and the state they set on one. */
export function inboxRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [inboxRoute(getPool), inboxItemStatePutRoute(getPool)];
}
