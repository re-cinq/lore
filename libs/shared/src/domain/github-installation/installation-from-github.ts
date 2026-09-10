import {
  GithubAccountTypeSchema,
  GithubRepositorySelectionSchema,
  type GithubInstallation,
} from "../models/github-installation.js";

/** The fields of GitHub's installation object that Lore records — the shape `GET /app/installations/{id}` answers with and the `installation` webhooks carry. */
export interface GithubInstallationPayload {
  id: number;
  account: { login: string; type: string };
  repository_selection: string;
  suspended_at: string | null;
}

/** An installation as GitHub describes it, read as the registry records it; an account type or repository selection outside the model's enums throws rather than being stored. */
export function installationFromGithub(
  payload: GithubInstallationPayload,
): Omit<GithubInstallation, "installedAt" | "updatedAt"> {
  return {
    installationId: String(payload.id),
    accountLogin: payload.account.login,
    accountType: GithubAccountTypeSchema.parse(payload.account.type),
    repositorySelection: GithubRepositorySelectionSchema.parse(
      payload.repository_selection,
    ),
    suspendedAt:
      payload.suspended_at === null ? null : new Date(payload.suspended_at),
  };
}
