import type { components } from "@/lib/api/schema";

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
}: GithubConnectSectionProps) {
  return (
    <section>
      <h2>GitHub</h2>
      <ul>
        {installations.map((installation) => (
          <li key={installation.installation_id}>
            {installation.account_login} — {installation.account_type},{" "}
            {installation.repository_selection} repos
          </li>
        ))}
      </ul>
    </section>
  );
}
