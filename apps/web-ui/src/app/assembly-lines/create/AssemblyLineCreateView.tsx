import { SubmitButton } from '@/components/SubmitButton';
import { TaskTypeSelect } from '@/components/TaskTypeSelect';
import styles from './AssemblyLineCreateView.module.css';

export interface AssemblyLineCreateViewProps {
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
export default function AssemblyLineCreateView({ onboardedRepos, createTaskAction }: AssemblyLineCreateViewProps) {
  return (
    <div>
      <h1>Create Task</h1>
      <form action={createTaskAction} className="task-form">
        <label>Description</label>
        <textarea name="description" rows={4} required placeholder="What should the agent do? Be specific..." />

        <label>Task Type</label>
        <TaskTypeSelect
          options={[
            { value: 'general', label: 'General' },
            { value: 'runbook', label: 'Runbook' },
            { value: 'implementation', label: 'Implementation' },
            { value: 'gap-fill', label: 'Gap Fill' },
          ]}
        />

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

        <SubmitButton pendingLabel="Creating…">Create Task</SubmitButton>
      </form>
    </div>
  );
}
