export const dynamic = "force-dynamic";
import { engineRoutedPagedJsonRoute } from "@/lib/floor-proxy";
import { eventsUpstream } from "@/lib/run-read-upstream";

// Session-authed history proxy; auth ladder matches the node-logs route (401 → 404 → 403). A run on the external floor keeps its events there, and lore-api reads them in the Floor's own shape.
export const GET = engineRoutedPagedJsonRoute(
  "assembly-line-run-events",
  eventsUpstream,
);
