import type { GithubInstallation } from "../../../domain/models/github-installation.js";

/** The registry of GitHub App installations (specs/4-ux-repo-onboarding FR-8): which accounts Lore is connected to, so a repo is served by the installation of its owner rather than by one installation fixed in the environment. */

export type UpsertGithubInstallationInput = Omit<
  GithubInstallation,
  "installedAt" | "updatedAt"
>;

export interface GithubInstallationsRepository {
  /** Record an installation, or refresh the one already recorded under its id. */
  upsert(input: UpsertGithubInstallationInput): Promise<GithubInstallation>;
  /** The installation covering this account, matched case-insensitively as GitHub logins are; null when the App is not installed there. */
  findByAccount(accountLogin: string): Promise<GithubInstallation | null>;
  /** Forget an installation — the App was uninstalled from its account, so nothing can be served through it any more. */
  remove(installationId: string): Promise<void>;
  /** Every installation, ordered by account login — the accounts the Connect GitHub page shows. */
  list(): Promise<GithubInstallation[]>;
}
