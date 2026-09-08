export const dynamic = "force-dynamic";
import { floorPagedJsonRoute } from "@/lib/floor-proxy";

// Session-authed history proxy to the Floor's /api/agent-events/{id}; auth ladder matches the node-logs route (401 → 404 → 403).
export const GET = floorPagedJsonRoute(
  "agent-events",
  "assembly-line-run-events",
);
