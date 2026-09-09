export const dynamic = "force-dynamic";
import { cancelTask } from "@/lib/api/tasks";
import { taskActionRoute } from "@/lib/task-action-route";

// Cancel a task, then bounce back to its page. State rules live in lore-api's cancel seam; this route forwards its refusal rather than re-deciding it.
export const POST = taskActionRoute(cancelTask, "Cancel", "cancel");
