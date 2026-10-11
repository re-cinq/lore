export const dynamic = "force-dynamic";
import { visitReadRoute } from "@/lib/visit-read-route";

// Session-authed proxy to lore-api's /api/assembly-runs/{id}/visits/{visitId}/model-calls (run-viz FR4.1i).
export const GET = visitReadRoute("model-calls");
