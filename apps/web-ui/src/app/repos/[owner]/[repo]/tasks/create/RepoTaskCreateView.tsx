import { SubmitButton } from "@/components/SubmitButton";
import { TaskTypeSelect } from "@/components/TaskTypeSelect";
import styles from "./RepoTaskCreateView.module.css";

export interface RepoTaskCreateViewProps {
  fullName: string;
  /** Server action wired to the create-task form ("actions up"). */
  createTaskAction: (formData: FormData) => void | Promise<void>;
}

/** The task types offerable from this form. A narrower set than the pipeline supports: `onboard` and `review` are started by the platform rather than typed in here. */
const TASK_TYPE_OPTIONS = [
  { value: "feature-request", label: "Feature Request" },
  { value: "general", label: "General" },
  { value: "runbook", label: "Runbook" },
  { value: "implementation", label: "Implementation" },
  { value: "gap-fill", label: "Gap Fill" },
];

/* eslint-disable re-lint/no-duplicate-code -- this form's markup (and its own DescriptionField) is a deliberate near-copy of AssemblyRunCreateView's, not a shared component neither form owns */
/** Per-repo "New Task" form: pure render, container resolves repo identity and handles create action. */
export default function RepoTaskCreateView(props: RepoTaskCreateViewProps) {
  const { fullName, createTaskAction } = props;

  return (
    <div>
      <h2>New Task for {fullName}</h2>
      <form action={createTaskAction} className={`task-form ${styles.form}`}>
        <input type="hidden" name="target_repo" value={fullName} />

        <label>Task Type</label>
        <TaskTypeSelect options={TASK_TYPE_OPTIONS} />

        <DescriptionField />

        <ImmediateCheckbox />

        <SubmitButton pendingLabel="Creating…">Create Task</SubmitButton>
      </form>
    </div>
  );
}

/** Plain language is enough here — the agent turns it into a spec — so the placeholder says so rather than asking for structure. */
function DescriptionField() {
  return (
    <>
      <label>Description</label>
      <textarea
        name="description"
        rows={5}
        required
        placeholder="Describe what you want built. Plain language is fine — the agent will translate it into a proper spec following this repo's conventions."
      />
    </>
  );
}
/* eslint-enable re-lint/no-duplicate-code */

/** Skip the queue. Off by default because the default path — waiting for local pickup — runs on a developer subscription rather than org API credit. */
function ImmediateCheckbox() {
  return (
    <label className={styles.checkboxLabel}>
      <input type="checkbox" name="priority" value="immediate" />
      <span>Execute immediately</span>
      <span className={`meta ${styles.hint}`}>
        — runs on GKE now instead of waiting for local pickup
      </span>
    </label>
  );
}
