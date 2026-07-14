import { SubmitButton } from "@/components/SubmitButton";
import { TaskTypeSelect } from "@/components/TaskTypeSelect";
import styles from "./RepoTaskCreateView.module.css";

export interface RepoTaskCreateViewProps {
  fullName: string;
  /** Server action wired to the create-task form ("actions up"). */
  createTaskAction: (formData: FormData) => void | Promise<void>;
}

/**
 * Presentational view for the per-repo "New Task" form. Pure render — the
 * container (`page.tsx`) resolves the repo identity and passes it down, and
 * hands in the create action which the form fires back up, keeping this
 * component free of data access.
 */
export default function RepoTaskCreateView({
  fullName,
  createTaskAction,
}: RepoTaskCreateViewProps) {
  return (
    <div>
      <h2>New Task for {fullName}</h2>
      <form action={createTaskAction} className={`task-form ${styles.form}`}>
        <input type="hidden" name="target_repo" value={fullName} />

        <label>Task Type</label>
        <TaskTypeSelect
          options={[
            { value: "feature-request", label: "Feature Request" },
            { value: "general", label: "General" },
            { value: "runbook", label: "Runbook" },
            { value: "implementation", label: "Implementation" },
            { value: "gap-fill", label: "Gap Fill" },
          ]}
        />

        <label>Description</label>
        <textarea
          name="description"
          rows={5}
          required
          placeholder="Describe what you want built. Plain language is fine — the agent will translate it into a proper spec following this repo's conventions."
        />

        <label className={styles.checkboxLabel}>
          <input type="checkbox" name="priority" value="immediate" />
          <span>Execute immediately</span>
          <span className={`meta ${styles.hint}`}>
            — runs on GKE now instead of waiting for local pickup
          </span>
        </label>

        <SubmitButton pendingLabel="Creating…">Create Task</SubmitButton>
      </form>
    </div>
  );
}
