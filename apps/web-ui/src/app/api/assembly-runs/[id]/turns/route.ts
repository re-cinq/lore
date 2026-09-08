export const dynamic = "force-dynamic";
import { floorPagedJsonRoute } from "@/lib/floor-proxy";

// Sibling of ./events: proxies UNTRUNCATED turns to the Floor's /api/agent-turns/{id} (#1148) for the on-demand full-transcript view; same 401→404→403 auth ladder.
export const GET = floorPagedJsonRoute(
  "agent-turns",
  "assembly-line-run-turns",
);
