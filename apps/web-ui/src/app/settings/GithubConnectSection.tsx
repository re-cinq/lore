import type { components } from "@/lib/api/schema";
import Icon from "@/components/Icon";
import { SettingsCard } from "@/components/SettingsCard";
import styles from "./GithubConnectSection.module.css";

export type GithubInstallationRow = components["schemas"]["GithubInstallation"];

export interface GithubConnectSectionProps {
  /** The connected accounts, as GET /api/github/installations lists them. */
  installations: GithubInstallationRow[];
  /** Where an admin installs the GitHub App on another account; null when the App's slug is not configured. */
  installUrl: string | null;
}

/** The Connect GitHub section of the settings page (specs/4-ux-repo-onboarding FR-8): the accounts Lore can serve repos for. */
export default function GithubConnectSection({
  installations,
  installUrl,
}: GithubConnectSectionProps) {
  return (
    <SettingsCard
      id="set-github"
      title="GitHub"
      action={
        installUrl && (
          <a href={installUrl} className={styles.installLink}>
            Install on another account
          </a>
        )
      }
    >
      <InstallationList installations={installations} />
    </SettingsCard>
  );
}

/** The connected accounts, or the sentence that says there are none yet. */
function InstallationList({
  installations,
}: Pick<GithubConnectSectionProps, "installations">) {
  if (installations.length === 0) {
    return <FirstConnectionPrompt />;
  }

  return (
    <ul className={styles.list}>
      {installations.map((installation) => (
        <InstallationRow
          key={installation.installation_id}
          installation={installation}
        />
      ))}
    </ul>
  );
}

function FirstConnectionPrompt() {
  return (
    <p className={styles.empty}>
      Lore is not connected to any GitHub account yet.
    </p>
  );
}

/** One account: who it is, what kind, which repos, and whether it is live. */
function InstallationRow(props: { installation: GithubInstallationRow }) {
  const { installation } = props;
  const suspended = installation.suspended_at !== null;

  return (
    <li className={styles.row}>
      <span className={styles.avatar} aria-hidden="true">
        <Icon name="github" size={18} />
      </span>
      <span className={styles.account}>
        <span className={styles.login}>{installation.account_login}</span>
        <span className={styles.detail}>{accountDetail(installation)}</span>
      </span>
      <span className={suspended ? styles.suspended : styles.installed}>
        {suspended ? "Suspended" : "Installed"}
      </span>
    </li>
  );
}

function accountDetail(installation: GithubInstallationRow): string {
  return `${installation.account_type} · ${installation.repository_selection} repos`;
}
