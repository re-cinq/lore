import ThemeSwitcher from "@/components/ThemeSwitcher";
import styles from "./SettingsView.module.css";

export interface SettingsApprovalConfig {
  required: boolean;
  label: string;
  auto_approve: string[];
  repos: Record<string, { required: boolean }>;
}

export interface SettingsViewProps {
  apiUrl: string;
  ingestToken: string;
  repoCount: number;
  totalTasks: number;
  tasksToday: number;
  approvalConfig: SettingsApprovalConfig;
  /** Newline-joined `owner/repo` list of per-repo approval overrides. */
  repoLines: string;
  /** Server actions wired to the forms ("actions up"). */
  saveSettings: (formData: FormData) => void | Promise<void>;
  saveApprovalConfig: (formData: FormData) => void | Promise<void>;
  regenerateToken: (formData: FormData) => void | Promise<void>;
}

export default function SettingsView(props: SettingsViewProps) {
  const { apiUrl, ingestToken, repoCount, totalTasks, tasksToday } = props;
  const { approvalConfig, repoLines } = props;
  const { saveSettings, saveApprovalConfig, regenerateToken } = props;

  return (
    <div>
      <h1>Settings</h1>
      <AppearanceSection />
      <PlatformStats
        repoCount={repoCount}
        totalTasks={totalTasks}
        tasksToday={tasksToday}
      />
      <PlatformConfigForm
        apiUrl={apiUrl}
        ingestToken={ingestToken}
        saveSettings={saveSettings}
        regenerateToken={regenerateToken}
      />
      <ApprovalGatesForm
        approvalConfig={approvalConfig}
        repoLines={repoLines}
        saveApprovalConfig={saveApprovalConfig}
      />
      <InstallCommand apiUrl={apiUrl} ingestToken={ingestToken} />
    </div>
  );
}

/** Theme lives in the browser, so this section is the one part of Settings that is per-device rather than per-org. */
function AppearanceSection() {
  return (
    <>
      <h2>Appearance</h2>
      <div className={`spec-card ${styles.appearanceCard}`}>
        <p className={`meta ${styles.appearanceNote}`}>
          Theme and appearance are stored in your browser and apply only to this
          device. Auto follows your operating system&apos;s light/dark setting.
        </p>
        <ThemeSwitcher />
      </div>
    </>
  );
}

function PlatformStats({
  repoCount,
  totalTasks,
  tasksToday,
}: Pick<SettingsViewProps, "repoCount" | "totalTasks" | "tasksToday">) {
  return (
    <div className={styles.statsRow}>
      <div className={`spec-card ${styles.statCard}`}>
        <div className="meta">Onboarded Repos</div>
        <div className={styles.statValue}>{repoCount}</div>
      </div>
      <div className={`spec-card ${styles.statCard}`}>
        <div className="meta">Total Tasks</div>
        <div className={styles.statValue}>{totalTasks}</div>
      </div>
      <div className={`spec-card ${styles.statCard}`}>
        <div className="meta">Tasks Today</div>
        <div className={styles.statValue}>{tasksToday}</div>
      </div>
    </div>
  );
}

/** Its own form, not another button beside Save: regenerating invalidates every existing token at once, so it must not ride a submit someone meant as a save. */
function RegenerateTokenForm({
  regenerateToken,
}: Pick<SettingsViewProps, "regenerateToken">) {
  return (
    <form action={regenerateToken} className={styles.regenerateForm}>
      <button type="submit" className={`danger ${styles.regenerateButton}`}>
        Regenerate Token
      </button>
      <span className={`meta ${styles.regenerateNote}`}>
        Warning: invalidates all existing tokens. You&apos;ll need to update all
        repos and developer installs.
      </span>
    </form>
  );
}

/** The shared token, and the two places it has to be repeated. Naming both — the developer install and the repo's Actions secret — is the point: changing it here alone leaves every install and every workflow on the old one. */
function IngestTokenField({
  ingestToken,
}: Pick<SettingsViewProps, "ingestToken">) {
  return (
    <>
      <label className={styles.labelSpaced}>Ingest Token</label>
      <input
        name="ingest_token"
        defaultValue={ingestToken || ""}
        className={styles.tokenInput}
      />
      <p className={`meta ${styles.fieldNote}`}>
        Shared token for authenticating ingest and task API calls. Set this in
        developer installs via{" "}
        <code>git config --global lore.ingest-token</code> and on repos as the{" "}
        <code>LORE_INGEST_TOKEN</code> GitHub Actions secret.
      </p>
    </>
  );
}

/** The URL and the token every install needs. Each note says where the value is USED, not what it is — a reader on this page already knows what an API URL is, and needs to know which workflows break if it is wrong. */
function PlatformFields({
  apiUrl,
  ingestToken,
}: Pick<SettingsViewProps, "apiUrl" | "ingestToken">) {
  return (
    <>
      <label>Lore API URL</label>
      <input
        name="api_url"
        defaultValue={apiUrl || ""}
        placeholder="https://your-lore-api.example.com"
      />
      <p className={`meta ${styles.fieldNote}`}>
        The external URL for the MCP server API. Used by GitHub Actions
        workflows and local Claude Code for task delegation.
      </p>

      <IngestTokenField ingestToken={ingestToken} />
    </>
  );
}

function PlatformConfigForm({
  apiUrl,
  ingestToken,
  saveSettings,
  regenerateToken,
}: Pick<
  SettingsViewProps,
  "apiUrl" | "ingestToken" | "saveSettings" | "regenerateToken"
>) {
  return (
    <>
      <h2>Platform Configuration</h2>
      <form action={saveSettings} className={`task-form ${styles.form}`}>
        <PlatformFields apiUrl={apiUrl} ingestToken={ingestToken} />

        <div className={styles.actions}>
          <button type="submit">Save</button>
        </div>
      </form>

      <RegenerateTokenForm regenerateToken={regenerateToken} />
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

/** Repos that always need approval. The tighter exemption, pulling the opposite way: these require it even when the global toggle is off. */
function ApprovalReposField({
  repoLines,
}: {
  repoLines: SettingsViewProps["repoLines"];
}) {
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
      <p className={`meta ${styles.fieldNote}`}>
        Per-repo overrides. Tasks targeting these repos always require approval,
        regardless of the global setting. Leave empty to use only the global
        toggle.
      </p>
    </>
  );
}

/** The two ways around the gate, and they pull in OPPOSITE directions: auto-approved task types skip it even when approval is required globally, while the listed repos always require it even when approval is off. */
function GateExemptions({
  autoApprove,
  repoLines,
}: {
  autoApprove: string[];
  repoLines: SettingsViewProps["repoLines"];
}) {
  return (
    <>
      <AutoApproveField autoApprove={autoApprove} />
      <ApprovalReposField repoLines={repoLines} />
    </>
  );
}

/** The gate itself: whether it applies, and which label opens it. Both belong together — the toggle is meaningless without knowing what a human is expected to add. */
function GateToggle({
  approvalConfig,
}: Pick<SettingsViewProps, "approvalConfig">) {
  return (
    <>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          name="approval_required"
          defaultChecked={approvalConfig.required}
        />
        Require approval for new tasks
      </label>
      <p className={`meta ${styles.fieldNote}`}>
        When enabled, new pipeline tasks will wait for a human to add the
        approval label on the GitHub Issue before the agent processes them.
      </p>

      <label className={styles.labelSpaced}>Approval Label</label>
      <input
        name="approval_label"
        defaultValue={approvalConfig.label}
        placeholder="approved"
      />
      <p className={`meta ${styles.fieldNote}`}>
        The GitHub Issue label that approves a task. The agent checks for this
        label every minute.
      </p>
    </>
  );
}

/** The gate that makes a human add a label before an agent picks a task up, plus the two ways around it: per-task-type and per-repo. */
function ApprovalGatesForm({
  approvalConfig,
  repoLines,
  saveApprovalConfig,
}: Pick<
  SettingsViewProps,
  "approvalConfig" | "repoLines" | "saveApprovalConfig"
>) {
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

function InstallCommand({
  apiUrl,
  ingestToken,
}: Pick<SettingsViewProps, "apiUrl" | "ingestToken">) {
  return (
    <>
      <h2 className={styles.sectionHeading}>Developer Install Command</h2>
      <div className="spec-card">
        <pre
          className={styles.installPre}
        >{`git clone git@github.com:re-cinq/lore.git
cd lore && scripts/install.sh

# After install, set the token:
git config --global lore.ingest-token ${ingestToken || "<token>"}
git config --global lore.api-url ${apiUrl || "https://your-lore-api.example.com"}`}</pre>
      </div>
    </>
  );
}
