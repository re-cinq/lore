import { SubmitButton } from "@/components/SubmitButton";
import { SettingsCard, SettingsSwitch } from "@/components/SettingsLayout";
import styles from "./SettingsView.module.css";
import type { SettingsViewProps } from "./SettingsView";

type ApprovalGatesFormProps = Pick<
  SettingsViewProps,
  "approvalConfig" | "repoLines" | "saveApprovalConfig"
>;

/** The gate that makes a human add a label before an agent picks a task up, plus the two ways around it: per-task-type and per-repo. */
export default function ApprovalGatesForm(props: ApprovalGatesFormProps) {
  return (
    <SettingsCard
      id="set-approval"
      title="Approval gates"
      description="Whether a person must approve a task before an agent picks it up, and the two ways around it."
    >
      <ApprovalForm {...props} />
    </SettingsCard>
  );
}

function ApprovalForm(props: ApprovalGatesFormProps) {
  const { approvalConfig, repoLines, saveApprovalConfig } = props;

  return (
    <form action={saveApprovalConfig} className={`task-form ${styles.form}`}>
      <GateToggle approvalConfig={approvalConfig} />
      <GateExemptions
        autoApprove={approvalConfig.auto_approve}
        repoLines={repoLines}
      />
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Saving…">Save approval gates</SubmitButton>
      </div>
    </form>
  );
}

type GateToggleProps = Pick<SettingsViewProps, "approvalConfig">;

/** The gate itself: whether it applies, and which label opens it. Both belong together — the toggle is meaningless without knowing what a human is expected to add. */
function GateToggle({ approvalConfig }: GateToggleProps) {
  return (
    <>
      <GateRequiredField required={approvalConfig.required} />
      <ApprovalLabelField label={approvalConfig.label} />
    </>
  );
}

function GateRequiredField({ required }: { required: boolean }) {
  return (
    <SettingsSwitch
      name="approval_required"
      defaultChecked={required}
      label="Require approval for new tasks"
      detail="New pipeline tasks wait for a human to add the approval label on the GitHub Issue before the agent processes them."
    />
  );
}

function ApprovalLabelField({ label }: { label: string }) {
  return (
    <>
      <label htmlFor="approval_label">Approval label</label>
      <input
        id="approval_label"
        name="approval_label"
        defaultValue={label}
        placeholder="approved"
      />
      <p className={styles.fieldNote}>
        The GitHub Issue label that approves a task. The agent checks for this
        label every minute.
      </p>
    </>
  );
}

interface GateExemptionsProps {
  autoApprove: string[];
  repoLines: SettingsViewProps["repoLines"];
}

/** The two ways around the gate, and they pull in OPPOSITE directions: auto-approved task types skip it even when approval is required globally, while the listed repos always require it even when approval is off. */
function GateExemptions({ autoApprove, repoLines }: GateExemptionsProps) {
  return (
    <>
      <AutoApproveField autoApprove={autoApprove} />
      <ApprovalReposField repoLines={repoLines} />
    </>
  );
}

/** Task types that skip the gate. The looser of the two exemptions: these run immediately even where approval is required globally. */
function AutoApproveField({ autoApprove }: { autoApprove: string[] }) {
  return (
    <>
      <label htmlFor="auto_approve">
        Auto-approve task types (comma-separated)
      </label>
      <input
        id="auto_approve"
        name="auto_approve"
        defaultValue={autoApprove.join(", ")}
        placeholder="general, gap-fill"
      />
      <p className={styles.fieldNote}>
        These task types skip the approval gate and are processed immediately,
        even when approval is required globally.
      </p>
    </>
  );
}

interface ApprovalReposFieldProps {
  repoLines: SettingsViewProps["repoLines"];
}

/** Repos that always need approval. The tighter exemption, pulling the opposite way: these require it even when the global toggle is off. */
function ApprovalReposField({ repoLines }: ApprovalReposFieldProps) {
  return (
    <>
      <label htmlFor="approval_repos">
        Repos requiring approval (one per line, owner/repo)
      </label>
      <textarea
        id="approval_repos"
        name="approval_repos"
        defaultValue={repoLines}
        rows={4}
        placeholder={"re-cinq/production-app\nre-cinq/billing-service"}
        className={styles.reposTextarea}
      />
      <ApprovalReposNote />
    </>
  );
}

function ApprovalReposNote() {
  return (
    <p className={styles.fieldNote}>
      Per-repo overrides. Tasks targeting these repos always require approval,
      regardless of the global setting. Leave empty to use only the global
      toggle.
    </p>
  );
}
