export const dynamic = "force-dynamic";
import { personRunActionRoute } from "@/lib/person-run-action";

// "Run this station" backend: asks lore-api to have the floor run the node again in the signed-in person's name. The segment is `[name]` because Next.js allows one slug name per level and the logs route named it first.
export const POST = personRunActionRoute<{ id: string; name: string }>(
  "assembly-run-node-run",
  (run, { name }) =>
    `/api/assembly-runs/${encodeURIComponent(run.id)}/nodes/${encodeURIComponent(name)}/run`,
);
