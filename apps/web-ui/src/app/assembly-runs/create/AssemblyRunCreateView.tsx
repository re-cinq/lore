import { SubmitButton } from "@/components/SubmitButton";
import { TaskTypeSelect } from "@/components/TaskTypeSelect";
import styles from "./AssemblyRunCreateView.module.css";

export interface AssemblyRunCreateViewProps {
  onboardedRepos: { full_name: string }[];
  createTaskAction: (formData: FormData) => void | Promise<void>;
}

interface TargetRepoFieldProps {
  repos: AssemblyRunCreateViewProps["onboardedRepos"];
}

function TargetRepoInput() {
  return (
    <input
      name="target_repo"
      defaultValue="re-cinq/lore"
      placeholder="owner/repo"
    />
  );
}

/** A picker once repos are onboarded, a free-text field before that — the first task on a fresh install has nothing to pick from, and typing the repo is how it gets created. */
function TargetRepoField({ repos }: TargetRepoFieldProps) {
  if (repos.length === 0) {
    return <TargetRepoInput />;
  }

  return (
    <select name="target_repo">
      {repos.map((r) => (
        <option key={r.full_name} value={r.full_name}>
          {r.full_name}
        </option>
      ))}
    </select>
  );
}

/** The task types a human can start from this form. Narrower than the full set on purpose: onboard and review are started by the platform in response to something, not typed in here. */
const TASK_TYPE_OPTIONS = [
  { value: "general", label: "General" },
  { value: "runbook", label: "Runbook" },
  { value: "implementation", label: "Implementation" },
  { value: "gap-fill", label: "Gap Fill" },
];

/** Opting out of the local-runner queue. Unchecked means the task waits to be picked up on a developer's machine, which is the cheaper default. */
function PriorityField() {
  return (
    <label className={styles.priorityLabel}>
      <input type="checkbox" name="priority" value="immediate" />
      <span>Execute immediately</span>
      <span className={`meta ${styles.priorityHint}`}>
        — runs on GKE now instead of waiting for local pickup
      </span>
    </label>
  );
}

function DescriptionField() {
  return (
    <>
      <label>Description</label>
      <textarea
        name="description"
        rows={4}
        required
        placeholder="What should the agent do? Be specific..."
      />
    </>
  );
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
        <DescriptionField />

        <label>Task Type</label>
        <TaskTypeSelect options={TASK_TYPE_OPTIONS} />

        <label>Target Repository</label>
        <TargetRepoField repos={onboardedRepos} />

        <PriorityField />

        <SubmitButton pendingLabel="Creating…">Create Task</SubmitButton>
      </form>
    </div>
  );
}
