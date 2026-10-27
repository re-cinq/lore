export const dynamic = "force-dynamic";
import { personRunActionRoute } from "@/lib/person-run-action";

// "Cancel run" backend: asks lore-api to cancel the run in the signed-in person's name.
export const POST = personRunActionRoute(
  "assembly-run-cancel",
  (run) => `/api/assembly-runs/${encodeURIComponent(run.id)}/cancel`,
);
