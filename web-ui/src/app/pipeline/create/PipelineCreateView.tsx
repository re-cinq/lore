import styles from './PipelineCreateView.module.css';

export interface PipelineCreateViewProps {
  /** Onboarded repos for the target-repo dropdown. */
  onboardedRepos: { full_name: string }[];
  /** Server action wired to the Create-Task form ("actions up"). */
  createTaskAction: (formData: FormData) => void | Promise<void>;
}

/**
 * Presentational view for the create-task form. Pure render — the
 * onboarded-repo list is resolved by the container (`page.tsx`) and passed
 * down; the only mutation (Create Task) is handed in as `createTaskAction`
 * and fired back up via the form, keeping this component free of data access.
 */
export default function PipelineCreateView({ onboardedRepos, createTaskAction }: PipelineCreateViewProps) {
  return (
    <div>
      <h1>Create Task</h1>
      <form action={createTaskAction} className="task-form">
        <label>Description</label>
        <textarea name="description" rows={4} required placeholder="What should the agent do? Be specific..." />

        <label>Task Type</label>
        <select name="task_type">
          <option value="general">General</option>
          <option value="runbook">Runbook</option>
          <option value="implementation">Implementation</option>
          <option value="gap-fill">Gap Fill</option>
        </select>

        <label>Target Repository</label>
        {onboardedRepos.length > 0 ? (
          <select name="target_repo">
            {onboardedRepos.map((r) => (
              <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
            ))}
          </select>
        ) : (
          <input name="target_repo" defaultValue="re-cinq/lore" placeholder="owner/repo" />
        )}

        <label className={styles.priorityLabel}>
          <input type="checkbox" name="priority" value="immediate" />
          <span>Execute immediately</span>
          <span className={`meta ${styles.priorityHint}`}>— runs on GKE now instead of waiting for local pickup</span>
        </label>

        <button type="submit">Create Task</button>
      </form>
    </div>
  );
}
