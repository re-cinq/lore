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
export default function RepoTaskCreateView({ fullName, createTaskAction }: RepoTaskCreateViewProps) {
  return (
    <div>
      <h2>New Task for {fullName}</h2>
      <form action={createTaskAction} className="task-form" style={{maxWidth:'600px'}}>
        <input type="hidden" name="target_repo" value={fullName} />

        <label>Task Type</label>
        <select name="task_type" id="task_type">
          <option value="feature-request">Feature Request (PM intent → spec)</option>
          <option value="general">General</option>
          <option value="runbook">Runbook</option>
          <option value="implementation">Implementation</option>
          <option value="gap-fill">Gap Fill</option>
        </select>

        <label>Description</label>
        <textarea name="description" rows={5} required placeholder="Describe what you want built. Plain language is fine — the agent will translate it into a proper spec following this repo's conventions." />

        <label style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer'}}>
          <input type="checkbox" name="priority" value="immediate" />
          <span>Execute immediately</span>
          <span className="meta" style={{fontSize:'var(--fs-xs)'}}>— runs on GKE now instead of waiting for local pickup</span>
        </label>

        <button type="submit">Create Task</button>
      </form>
    </div>
  );
}
