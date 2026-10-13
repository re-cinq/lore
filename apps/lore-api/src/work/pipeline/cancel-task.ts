import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

export interface CancelTaskDeps {
  cancelTask(taskId: string): Promise<{ task_id: string; status: string }>;
  runs: Pick<AssemblyRunsPort, "listForTask" | "finish">;
}

const OPEN_RUN = new Set(["queued", "running"]);

/** Cancels a task and ends every assembly run still open for it. A run left running kept its subject lock, kept a parked wait for a PR, and was resumed by a later Retry (plan 3b3a67af, run 18773dbb, 2026-09-28). */
export async function cancelTaskAndItsRuns(
  taskId: string,
  deps: CancelTaskDeps,
): Promise<{ task_id: string; status: string }> {
  const result = await deps.cancelTask(taskId);
  const open = (await deps.runs.listForTask(taskId)).filter((run) =>
    OPEN_RUN.has(run.status),
  );

  await Promise.all(
    open.map((run) =>
      deps.runs.finish(run.id, "cancelled", `task ${taskId} cancelled`),
    ),
  );

  return result;
}
