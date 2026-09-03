import { SubmitButton } from "@/components/SubmitButton";
import { TaskTypeSelect } from "@/components/TaskTypeSelect";
import styles from "./AssemblyRunCreateView.module.css";

export interface AssemblyRunCreateViewProps {
  onboardedRepos: { full_name: string }[];
  createTaskAction: (formData: FormData) => void | Promise<void>;
}

// Pure render — page.tsx resolves the repo list; the only mutation (Create Task) is passed in as createTaskAction and fired via the form.
export default function AssemblyRunCreateView({
  onboardedRepos,
  createTaskAction,
}: AssemblyRunCreateViewProps) {
  return (
    <div>
      <h1>Create Task</h1>
      <form action={createTaskAction} className="task-form">
        <label>Description</label>
        <textarea
          name="description"
          rows={4}
          required
          placeholder="What should the agent do? Be specific..."
        />

        <label>Task Type</label>
        <TaskTypeSelect
          options={[
            { value: "general", label: "General" },
            { value: "runbook", label: "Runbook" },
            { value: "implementation", label: "Implementation" },
            { value: "gap-fill", label: "Gap Fill" },
          ]}
        />

        <label>Target Repository</label>
        {onboardedRepos.length > 0 ? (
          <select name="target_repo">
            {onboardedRepos.map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name}
              </option>
            ))}
          </select>
        ) : (
          <input
            name="target_repo"
            defaultValue="re-cinq/lore"
            placeholder="owner/repo"
          />
        )}

        <label className={styles.priorityLabel}>
          <input type="checkbox" name="priority" value="immediate" />
          <span>Execute immediately</span>
          <span className={`meta ${styles.priorityHint}`}>
            — runs on GKE now instead of waiting for local pickup
          </span>
        </label>

        <SubmitButton pendingLabel="Creating…">Create Task</SubmitButton>
      </form>
    </div>
  );
}
