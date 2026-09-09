import styles from "./SettingsView.module.css";
import type { SettingsViewProps } from "./SettingsView";

type ApprovalGatesFormProps = Pick<
  SettingsViewProps,
  "approvalConfig" | "repoLines" | "saveApprovalConfig"
>;

/** The gate that makes a human add a label before an agent picks a task up, plus the two ways around it: per-task-type and per-repo. */
export default function ApprovalGatesForm(props: ApprovalGatesFormProps) {
  const { approvalConfig, repoLines, saveApprovalConfig } = props;

  return (
    <>
      <h2 className={styles.sectionHeading}>Approval Gates</h2>
      <form action={saveApprovalConfig} className={`task-form ${styles.form}`}>
        <GateToggle approvalConfig={approvalConfig} />

        <GateExemptions
          autoApprove={approvalConfig.auto_approve}
          repoLines={repoLines}
        />

        <div className={styles.actions}>
          <button type="submit">Save Approval Config</button>
        </div>
      </form>
    </>
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
    <>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          name="approval_required"
          defaultChecked={required}
        />
        Require approval for new tasks
      </label>
      <p className={`meta ${styles.fieldNote}`}>
        When enabled, new pipeline tasks will wait for a human to add the
        approval label on the GitHub Issue before the agent processes them.
      </p>
    </>
  );
}

function ApprovalLabelField({ label }: { label: string }) {
  return (
    <>
      <label className={styles.labelSpaced}>Approval Label</label>
      <input
        name="approval_label"
        defaultValue={label}
        placeholder="approved"
      />
      <p className={`meta ${styles.fieldNote}`}>
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
      <label className={styles.labelSpaced}>
        Auto-approve Task Types (comma-separated)
      </label>
      <input
        name="auto_approve"
        defaultValue={autoApprove.join(", ")}
        placeholder="general, gap-fill"
      />
      <p className={`meta ${styles.fieldNote}`}>
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
      <label className={styles.labelSpaced}>
        Repos Requiring Approval (one per line, owner/repo)
      </label>
      <textarea
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
    <p className={`meta ${styles.fieldNote}`}>
      Per-repo overrides. Tasks targeting these repos always require approval,
      regardless of the global setting. Leave empty to use only the global
      toggle.
    </p>
  );
}
