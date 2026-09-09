import ThemeSwitcher from "@/components/ThemeSwitcher";
import ApprovalGatesForm from "./ApprovalGatesForm";
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

/** Each section declares the slice of the settings it consumes in its own props type, so the whole bag is handed down and narrowed there rather than re-listed here. */
export default function SettingsView(props: SettingsViewProps) {
  return (
    <div>
      <h1>Settings</h1>
      <AppearanceSection />
      <PlatformStats {...props} />
      <PlatformConfigForm {...props} />
      <ApprovalGatesForm {...props} />
      <InstallCommand {...props} />
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

type PlatformStatsProps = Pick<
  SettingsViewProps,
  "repoCount" | "totalTasks" | "tasksToday"
>;

function PlatformStats(stats: PlatformStatsProps) {
  const { repoCount, totalTasks, tasksToday } = stats;

  return (
    <div className={styles.statsRow}>
      <StatCard label="Onboarded Repos" value={repoCount} />
      <StatCard label="Total Tasks" value={totalTasks} />
      <StatCard label="Tasks Today" value={tasksToday} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className={`spec-card ${styles.statCard}`}>
      <div className="meta">{label}</div>
      <div className={styles.statValue}>{value}</div>
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

type PlatformConfigFormProps = Pick<
  SettingsViewProps,
  "apiUrl" | "ingestToken" | "saveSettings" | "regenerateToken"
>;

function PlatformConfigForm(props: PlatformConfigFormProps) {
  const { apiUrl, ingestToken, saveSettings, regenerateToken } = props;

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
