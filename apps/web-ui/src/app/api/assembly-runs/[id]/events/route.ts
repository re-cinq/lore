export const dynamic = "force-dynamic";
import { runPagedJsonRoute } from "@/lib/floor-proxy";
import { eventsUpstream } from "@/lib/run-read-upstream";

// Session-authed history proxy; auth ladder matches the node-logs route (401 → 404 → 403). lore-api answers for a run of either engine.
export const GET = runPagedJsonRoute(
  "assembly-line-run-events",
  eventsUpstream,
);
