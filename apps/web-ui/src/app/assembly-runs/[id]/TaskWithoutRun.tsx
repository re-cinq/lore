import Link from "next/link";
import type { Task } from "@/lib/api/tasks";
import { formatEnumLabel } from "@/lib/enum-label";

interface TaskWithoutRunProps {
  task: Pick<Task, "status" | "target_repo" | "failure_reason">;
}

/** What a task id resolves to when nothing ran for it: a start the floor refused, or a task from before runs were recorded. */
export default function TaskWithoutRun({ task }: TaskWithoutRunProps) {
  return (
    <div>
      <div className="breadcrumb">
        <Link href="/assembly-runs">Assembly Runs</Link> /{" "}
        <Link href={`/repos/${task.target_repo}`}>{task.target_repo}</Link>
      </div>
      <h1>This task has no run</h1>
      <span className={`op-badge op-${task.status}`}>
        {formatEnumLabel(task.status)}
      </span>
      {task.failure_reason ? <p>{task.failure_reason}</p> : null}
    </div>
  );
}
