import ThemeSwitcher from "@/components/ThemeSwitcher";
import CopyButton from "@/components/CopyButton";
import { SubmitButton } from "@/components/SubmitButton";
import SettingsLayout, { type SettingsNavItem } from "@/components/SettingsLayout";
import { SettingsCard } from "@/components/SettingsCard";
import { SettingsHeader } from "@/components/SettingsHeader";
import ApprovalGatesForm from "./ApprovalGatesForm";
import SlackPeopleForm from "./SlackPeopleForm";
import GithubConnectSection, {
  type GithubInstallationRow,
} from "./GithubConnectSection";
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
  /** The org setting `slack_users` as one `login id` pair per line. */
  slackPeopleLines: string;
  /** Lines the last save refused, shown back with the text as typed; empty when nothing was refused. */
  slackPeopleRejected: string[];
  saveSlackPeople: (formData: FormData) => void | Promise<void>;
  regenerateToken: (formData: FormData) => void | Promise<void>;
  /** The GitHub accounts Lore is connected to (specs/4-ux-repo-onboarding FR-8). */
  githubInstallations: GithubInstallationRow[];
  /** Where an admin installs the GitHub App on another account; null while its slug is not configured. */
  githubInstallUrl: string | null;
}

/** The sub-navigation, in the order the cards are shown. */
const SETTINGS_NAV: SettingsNavItem[] = [
  { id: "set-appearance", label: "Appearance" },
  { id: "set-github", label: "GitHub" },
  { id: "set-platform", label: "Platform" },
  { id: "set-approval", label: "Approval gates" },
  { id: "set-slack", label: "Slack people" },
  { id: "set-install", label: "Developer install" },
  { id: "set-danger", label: "Danger zone", danger: true },
];

/** Each section declares the slice of the settings it consumes in its own props type, so the whole bag is handed down and narrowed there rather than re-listed here. */
export default function SettingsView(props: SettingsViewProps) {
  return (
    <div>
      <SettingsHeader eyebrow="{org}" title="Settings" />
      <SettingsLayout nav={SETTINGS_NAV}>
        <AppearanceSection />
        <GithubConnectSection
          installations={props.githubInstallations}
          installUrl={props.githubInstallUrl}
        />
        <PlatformConfigForm {...props} />
        <ApprovalGatesForm {...props} />
        <SlackPeopleForm {...props} />
        <InstallCommand {...props} />
        <RegenerateTokenSection regenerateToken={props.regenerateToken} />
      </SettingsLayout>
    </div>
  );
}

/** Theme lives in the browser, so this section is the one part of Settings that is per-device rather than per-org. */
function AppearanceSection() {
  return (
    <SettingsCard
      id="set-appearance"
      title="Appearance"
      description="Stored in this browser only. Auto follows your operating system's light/dark setting."
    >
      <ThemeSwitcher />
    </SettingsCard>
  );
}

type PlatformStatsProps = Pick<
  SettingsViewProps,
  "repoCount" | "totalTasks" | "tasksToday"
>;

type PlatformConfigFormProps = PlatformStatsProps &
  Pick<SettingsViewProps, "apiUrl" | "ingestToken" | "saveSettings">;

/** The platform's numbers, then the URL and token every install needs. */
function PlatformConfigForm(props: PlatformConfigFormProps) {
  const { apiUrl, ingestToken, saveSettings } = props;

  return (
    <SettingsCard id="set-platform" title="Platform">
      <PlatformStats {...props} />
      <form action={saveSettings} className={`task-form ${styles.form}`}>
        <PlatformFields apiUrl={apiUrl} ingestToken={ingestToken} />
        <div className={styles.actions}>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </div>
      </form>
    </SettingsCard>
  );
}

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
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}

/** Each note says where the value is USED, not what it is — a reader on this page already knows what an API URL is, and needs to know which workflows break if it is wrong. */
function PlatformFields({
  apiUrl,
  ingestToken,
}: Pick<SettingsViewProps, "apiUrl" | "ingestToken">) {
  return (
    <>
      <ApiUrlField apiUrl={apiUrl} />
      <IngestTokenField ingestToken={ingestToken} />
    </>
  );
}

function ApiUrlField({ apiUrl }: Pick<SettingsViewProps, "apiUrl">) {
  return (
    <>
      <label htmlFor="api_url">Lore API URL</label>
      <input
        id="api_url"
        name="api_url"
        defaultValue={apiUrl || ""}
        placeholder="https://your-lore-api.example.com"
        className={styles.monoInput}
      />
      <p className={styles.fieldNote}>
        The external URL for the MCP server API. Used by GitHub Actions
        workflows and local Claude Code for task delegation.
      </p>
    </>
  );
}

/** The shared token, and the two places it has to be repeated: changing it here alone leaves every install and every workflow on the old one. */
function IngestTokenField({
  ingestToken,
}: Pick<SettingsViewProps, "ingestToken">) {
  return (
    <>
      <label htmlFor="ingest_token">Ingest token</label>
      <span className={styles.tokenRow}>
        <input
          id="ingest_token"
          name="ingest_token"
          defaultValue={ingestToken || ""}
          className={styles.monoInput}
        />
        {ingestToken && <CopyButton text={ingestToken} />}
      </span>
      <IngestTokenNote />
    </>
  );
}

function IngestTokenNote() {
  return (
    <p className={styles.fieldNote}>
      Shared token for authenticating ingest and task API calls. Set this in
      developer installs via <code>git config --global lore.ingest-token</code>{" "}
      and on repos as the <code>LORE_INGEST_TOKEN</code> GitHub Actions secret.
    </p>
  );
}

/** Its own form and card, not another button beside Save: regenerating invalidates every existing token at once, so it must not ride a submit someone meant as a save. */
function RegenerateTokenSection({
  regenerateToken,
}: Pick<SettingsViewProps, "regenerateToken">) {
  return (
    <SettingsCard
      id="set-danger"
      title="Regenerate ingest token"
      description="Warning: invalidates all existing tokens. Every repo and developer install needs the new one."
      danger
      action={<RegenerateTokenForm regenerateToken={regenerateToken} />}
    />
  );
}

function RegenerateTokenForm({
  regenerateToken,
}: Pick<SettingsViewProps, "regenerateToken">) {
  return (
    <form action={regenerateToken}>
      <SubmitButton
        className={`danger ${styles.regenerateButton}`}
        pendingLabel="Regenerating…"
      >
        Regenerate token
      </SubmitButton>
    </form>
  );
}

function InstallCommand({
  apiUrl,
  ingestToken,
}: Pick<SettingsViewProps, "apiUrl" | "ingestToken">) {
  const command = installCommand(apiUrl, ingestToken);

  return (
    <SettingsCard
      id="set-install"
      title="Developer install"
      action={<CopyButton text={command} />}
    >
      <pre className={styles.installPre}>{command}</pre>
    </SettingsCard>
  );
}

function installCommand(apiUrl: string, ingestToken: string): string {
  return `git clone git@github.com:re-cinq/lore.git
cd lore && scripts/install.sh

# After install, set the token:
git config --global lore.ingest-token ${ingestToken || "<token>"}
git config --global lore.api-url ${apiUrl || "https://your-lore-api.example.com"}`;
}
