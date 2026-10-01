export const dynamic = "force-dynamic";
import { engineRoutedPagedJsonRoute } from "@/lib/floor-proxy";
import { turnsUpstream } from "@/lib/run-read-upstream";

// Sibling of ./events: proxies UNTRUNCATED turns (#1148) for the on-demand full-transcript view; same 401→404→403 auth ladder. A run on the external floor keeps its turns there, and lore-api reads them.
export const GET = engineRoutedPagedJsonRoute(
  "assembly-line-run-turns",
  turnsUpstream,
);
