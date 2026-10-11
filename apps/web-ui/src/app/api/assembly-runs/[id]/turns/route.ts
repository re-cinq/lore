export const dynamic = "force-dynamic";
import { runPagedJsonRoute } from "@/lib/floor-proxy";
import { turnsUpstream } from "@/lib/run-read-upstream";

// Sibling of ./events: proxies UNTRUNCATED turns (#1148) for the on-demand full-transcript view; same 401→404→403 auth ladder. lore-api answers for a run of either engine.
export const GET = runPagedJsonRoute("assembly-line-run-turns", turnsUpstream);
