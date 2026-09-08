export const dynamic = "force-dynamic";
import { runTaskNow } from "@/lib/api/tasks";
import { taskActionRoute } from "@/lib/task-action-route";

// Escalate a queued task to `immediate`, then bounce back to its page; lore-api owns the guard (only pending → 409 otherwise).
export const POST = taskActionRoute(runTaskNow, "Run now", "run-now");
